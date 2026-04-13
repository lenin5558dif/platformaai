import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  default: vi.fn(),
}));

const { mockAuthFn, mockPrismaDb } = vi.hoisted(() => ({
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
  preflightCredits: vi.fn(async () => {
    throw new Error("INSUFFICIENT_BALANCE");
  }),
  spendCredits: vi.fn(),
  reserveAiQuotaHold: vi.fn(async () => null),
  commitAiQuotaHold: vi.fn(),
  releaseAiQuotaHold: vi.fn(),
}));

import { POST } from "@/app/api/ai/chat/route";

describe("Preflight before external call", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
