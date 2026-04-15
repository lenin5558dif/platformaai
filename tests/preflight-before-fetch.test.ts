import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  default: vi.fn(),
}));

const {
  mockAuthFn,
  mockPrismaDb,
  estimateChatPromptTokens,
  estimateUpperBoundCredits,
  preflightCredits,
  reserveAiQuotaHold,
  commitAiQuotaHold,
  releaseAiQuotaHold,
  spendCredits,
  calculateCreditsFromUsage,
} = vi.hoisted(() => ({
  mockAuthFn: vi.fn(),
  mockPrismaDb: {
    user: {
      findUnique: vi.fn(),
    },
    message: {
      create: vi.fn(),
    },
    chat: {
      update: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
    },
    orgMembership: {
      findUnique: vi.fn(),
    },
    platformConfig: {
      upsert: vi.fn().mockResolvedValue({
        id: "default",
        globalSystemPrompt: null,
        disabledModelIds: [],
        updatedAt: new Date(),
        updatedById: null,
      }),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    orgProviderCredential: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    },
    adminPasswordResetToken: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  estimateChatPromptTokens: vi.fn(() => 10),
  estimateUpperBoundCredits: vi.fn(async () => 5),
  preflightCredits: vi.fn(async () => {
    throw new Error("INSUFFICIENT_BALANCE");
  }),
  reserveAiQuotaHold: vi.fn(async () => null),
  commitAiQuotaHold: vi.fn(),
  releaseAiQuotaHold: vi.fn(),
  spendCredits: vi.fn(),
  calculateCreditsFromUsage: vi.fn(async () => ({ credits: 0 })),
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

vi.mock("@/lib/openrouter", () => ({
  getOpenRouterBaseUrl: vi.fn(() => "https://openrouter.test"),
  getOpenRouterHeaders: vi.fn(() => ({ Authorization: "Bearer test" })),
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

vi.mock("@/lib/pricing", () => ({
  calculateCreditsFromUsage,
}));

vi.mock("@/lib/quota-estimation", () => ({
  estimateChatPromptTokens,
  estimateUpperBoundCredits,
}));

vi.mock("@/lib/billing", () => ({
  preflightCredits,
  spendCredits,
  reserveAiQuotaHold,
  commitAiQuotaHold,
  releaseAiQuotaHold,
}));

vi.mock("@/lib/org-settings", () => ({
  getOrgDlpPolicy: vi.fn(() => null),
  getOrgModelPolicy: vi.fn(() => null),
}));

vi.mock("@/lib/ai-authorization", () => ({
  validateModelPolicy: vi.fn(async () => ({ ok: true })),
  filterFallbackModels: vi.fn((models: string[]) => models),
  applyDlpToMessages: vi.fn(async ({ messages }: { messages: unknown[] }) => ({
    ok: true,
    messages,
  })),
}));

vi.mock("@/lib/search", () => ({
  searchWeb: vi.fn(async () => []),
}));

vi.mock("@/lib/cache", () => ({
  buildCacheKey: vi.fn(() => "cache-key"),
  getCachedResponse: vi.fn(() => null),
  setCachedResponse: vi.fn(),
}));

vi.mock("@/lib/summary", () => ({
  updateChatSummary: vi.fn(async () => undefined),
}));

vi.mock("@/lib/user-settings", () => ({
  getUserOpenRouterKey: vi.fn(() => undefined),
}));

import { POST } from "@/app/api/ai/chat/route";

describe("Preflight before external call", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    estimateUpperBoundCredits.mockResolvedValue(5);
    preflightCredits.mockImplementation(async () => {
      throw new Error("INSUFFICIENT_BALANCE");
    });
    reserveAiQuotaHold.mockResolvedValue(null);
    calculateCreditsFromUsage.mockResolvedValue({ credits: 0 });
    mockPrismaDb.message.create.mockResolvedValue({});
    mockPrismaDb.chat.update.mockResolvedValue({});
  });

  it("does not call fetch if preflight fails", async () => {
    mockAuthFn.mockResolvedValue({ user: { id: "u1", orgId: null } });
    mockPrismaDb.user.findUnique.mockResolvedValue({
      balance: 10,
      settings: null,
      costCenterId: null,
      orgId: null,
    });
    mockPrismaDb.organization.findUnique.mockResolvedValue(null);

    const fetchSpy = vi.spyOn(globalThis, "fetch" as any).mockImplementation(
      async () => {
        throw new Error("fetch should not be called");
      }
    );

    const req = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        chatId: "chat-1",
        stream: false,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(402);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("allows a free chat request without balance", async () => {
    mockAuthFn.mockResolvedValue({ user: { id: "u1", orgId: null } });
    mockPrismaDb.user.findUnique.mockResolvedValue({
      balance: 0,
      settings: null,
      costCenterId: null,
      orgId: null,
      subscription: null,
    });
    mockPrismaDb.organization.findUnique.mockResolvedValue(null);
    estimateUpperBoundCredits.mockResolvedValueOnce(0);

    const fetchSpy = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "free reply" } }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      ) as any
    );

    const req = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        chatId: "chat-1",
        stream: false,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalled();
    expect(preflightCredits).not.toHaveBeenCalled();
    expect(reserveAiQuotaHold).not.toHaveBeenCalled();
    expect(spendCredits).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
