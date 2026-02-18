import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  default: vi.fn(),
}));

const {
  mockAuthFn,
  mockPrismaDb,
  mockReserveAiQuotaHold,
  mockReleaseAiQuotaHold,
  mockCommitAiQuotaHold,
  mockPreflightCredits,
  mockSpendCredits,
} = vi.hoisted(() => ({
  mockAuthFn: vi.fn(),
  mockPrismaDb: {
    user: {
      findUnique: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
    },
    orgMembership: {
      findUnique: vi.fn(),
    },
    message: {
      create: vi.fn(),
    },
    chat: {
      update: vi.fn(),
    },
  },
  mockReserveAiQuotaHold: vi.fn(),
  mockReleaseAiQuotaHold: vi.fn(),
  mockCommitAiQuotaHold: vi.fn(),
  mockPreflightCredits: vi.fn(),
  mockSpendCredits: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuthFn,
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrismaDb,
}));

vi.mock("@/lib/chat-ownership", () => ({
  findOwnedChat: vi.fn(async () => ({ summary: null, attachments: [] })),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
}));

vi.mock("@/lib/personalization", () => ({
  buildPersonalizationSystemPrompt: vi.fn(() => ""),
}));

vi.mock("@/lib/moderation", () => ({
  checkModeration: vi.fn(() => ({ ok: true })),
}));

vi.mock("@/lib/telemetry", () => ({
  logEvent: vi.fn(async () => {}),
}));

vi.mock("@/lib/quota-estimation", () => ({
  estimateChatPromptTokens: vi.fn(() => 10),
  estimateUpperBoundCredits: vi.fn(async () => 5),
}));

vi.mock("@/lib/billing", () => ({
  preflightCredits: mockPreflightCredits,
  spendCredits: mockSpendCredits,
  reserveAiQuotaHold: mockReserveAiQuotaHold,
  commitAiQuotaHold: mockCommitAiQuotaHold,
  releaseAiQuotaHold: mockReleaseAiQuotaHold,
}));

vi.mock("@/lib/cache", () => ({
  buildCacheKey: vi.fn(() => "test-cache-key"),
  getCachedResponse: vi.fn(() => null),
  setCachedResponse: vi.fn(),
}));

vi.mock("@/lib/openrouter", () => ({
  getOpenRouterBaseUrl: vi.fn(() => "https://openrouter.ai/api/v1"),
  getOpenRouterHeaders: vi.fn(() => ({
    Authorization: "Bearer test-key",
    "Content-Type": "application/json",
  })),
}));

import { POST as chatPost } from "@/app/api/ai/chat/route";

describe("ABAC gate - quota hold lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthFn.mockResolvedValue({ user: { id: "u1", orgId: null } });
    mockPrismaDb.user.findUnique.mockResolvedValue({
      balance: 100,
      settings: null,
      costCenterId: null,
      orgId: null,
    });
    mockPrismaDb.organization.findUnique.mockResolvedValue(null);
  });

  it("calls releaseAiQuotaHold when fetch throws, does not call commitAiQuotaHold", async () => {
    const dummyHold = {
      orgId: "org-1",
      idempotencyKey: "test-key",
      daily: { reservations: [{ id: "r1" }] },
    };
    mockReserveAiQuotaHold.mockResolvedValue(dummyHold);

    // Mock fetch to throw (simulating OpenRouter failure)
    const fetchSpy = vi.spyOn(globalThis, "fetch" as any).mockImplementation(async () => {
      throw new Error("Network error");
    });

    const req = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        chatId: "chat-1",
        stream: false,
      }),
    });

    const res = await chatPost(req);

    // Should return 502 (Bad Gateway) when fetch fails
    expect(res.status).toBe(502);

    // Verify reserveAiQuotaHold was called
    expect(mockReserveAiQuotaHold).toHaveBeenCalledTimes(1);
    expect(mockReserveAiQuotaHold).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        amount: expect.any(Number),
        idempotencyKey: expect.any(String),
      })
    );

    // Verify releaseAiQuotaHold was called with the hold
    expect(mockReleaseAiQuotaHold).toHaveBeenCalledTimes(1);
    expect(mockReleaseAiQuotaHold).toHaveBeenCalledWith({ hold: dummyHold });

    // Verify commitAiQuotaHold was NOT called
    expect(mockCommitAiQuotaHold).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("calls releaseAiQuotaHold when OpenRouter returns non-ok response", async () => {
    const dummyHold = {
      orgId: "org-1",
      idempotencyKey: "test-key",
      daily: { reservations: [{ id: "r1" }] },
    };
    mockReserveAiQuotaHold.mockResolvedValue(dummyHold);

    // Mock fetch to return non-ok response
    const fetchSpy = vi.spyOn(globalThis, "fetch" as any).mockImplementation(async () => ({
      ok: false,
      status: 429,
      text: async () => "Rate limited",
    }));

    const req = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        chatId: "chat-1",
        stream: false,
      }),
    });

    const res = await chatPost(req);

    // Should return the upstream status
    expect(res.status).toBe(429);

    // Verify releaseAiQuotaHold was called
    expect(mockReleaseAiQuotaHold).toHaveBeenCalledTimes(1);
    expect(mockReleaseAiQuotaHold).toHaveBeenCalledWith({ hold: dummyHold });

    // Verify commitAiQuotaHold was NOT called
    expect(mockCommitAiQuotaHold).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("calls commitAiQuotaHold on successful non-streaming response", async () => {
    const dummyHold = {
      orgId: "org-1",
      idempotencyKey: "test-key",
      daily: { reservations: [{ id: "r1" }] },
    };
    mockReserveAiQuotaHold.mockResolvedValue(dummyHold);
    mockSpendCredits.mockResolvedValue({});

    // Mock successful response
    const fetchSpy = vi.spyOn(globalThis, "fetch" as any).mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "Hello!" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    }));

    const req = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        chatId: "chat-1",
        stream: false,
      }),
    });

    const res = await chatPost(req);

    expect(res.status).toBe(200);

    // Verify commitAiQuotaHold was called
    expect(mockCommitAiQuotaHold).toHaveBeenCalledTimes(1);
    expect(mockCommitAiQuotaHold).toHaveBeenCalledWith(
      expect.objectContaining({
        hold: dummyHold,
        finalAmount: expect.any(Number),
      })
    );

    // Verify releaseAiQuotaHold was NOT called on success
    expect(mockReleaseAiQuotaHold).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("calls releaseAiQuotaHold when preflightCredits throws (no quota hold)", async () => {
    // reserveAiQuotaHold returns null, so preflightCredits is called
    mockReserveAiQuotaHold.mockResolvedValue(null);
    mockPreflightCredits.mockRejectedValue(new Error("INSUFFICIENT_BALANCE"));

    const fetchSpy = vi.spyOn(globalThis, "fetch" as any).mockImplementation(async () => {
      throw new Error("fetch should not be called");
    });

    const req = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        chatId: "chat-1",
        stream: false,
      }),
    });

    const res = await chatPost(req);

    // Should return 402 for insufficient balance
    expect(res.status).toBe(402);

    // Verify preflightCredits was called
    expect(mockPreflightCredits).toHaveBeenCalledTimes(1);

    // Verify fetch was NOT called
    expect(fetchSpy).not.toHaveBeenCalled();

    // commitAiQuotaHold should not be called since we failed before fetch
    expect(mockCommitAiQuotaHold).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
