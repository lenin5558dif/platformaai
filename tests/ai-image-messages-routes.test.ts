import assert from "node:assert/strict";
import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    attachment: {
      findFirst: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    orgMembership: {
      findUnique: vi.fn(),
    },
    chat: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    message: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
    },
    orgMembershipAllowedCostCenter: {
      count: vi.fn(),
      findUnique: vi.fn(),
    },
    costCenter: {
      findFirst: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  getOpenRouterBaseUrl: vi.fn(() => "https://openrouter.test"),
  getOpenRouterHeaders: vi.fn(() => ({ Authorization: "Bearer test" })),
  getUserOpenRouterKey: vi.fn(() => "user-key"),
  calculateCreditsFromUsage: vi.fn(),
  preflightCredits: vi.fn(),
  reserveAiQuotaHold: vi.fn(),
  commitAiQuotaHold: vi.fn(),
  releaseAiQuotaHold: vi.fn(),
  spendCredits: vi.fn(),
  mapBillingError: vi.fn(),
  estimateTokensFromText: vi.fn(() => 12),
  estimateUpperBoundCredits: vi.fn(),
  getOrgModelPolicy: vi.fn(),
  getOrgDlpPolicy: vi.fn(),
  validateModelPolicy: vi.fn(),
  applyDlpToText: vi.fn(),
  findOwnedChat: vi.fn(),
  resolveOrgCostCenterId: vi.fn(),
  logEvent: vi.fn(),
  logAudit: vi.fn(),
  isModelAllowed: vi.fn(),
  getStripe: vi.fn(),
  recordStripeWebhookEvent: vi.fn(),
  randomBytes: vi.fn(() => Buffer.from("0123456789abcdef0123456789abcdef", "hex")),
  readFile: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: state.auth,
}));

vi.mock("@/lib/db", () => ({
  prisma: state.prisma,
}));

vi.mock("@/lib/openrouter", () => ({
  getOpenRouterBaseUrl: state.getOpenRouterBaseUrl,
  getOpenRouterHeaders: state.getOpenRouterHeaders,
}));

vi.mock("@/lib/user-settings", () => ({
  getUserOpenRouterKey: state.getUserOpenRouterKey,
}));

vi.mock("@/lib/pricing", () => ({
  calculateCreditsFromUsage: state.calculateCreditsFromUsage,
}));

vi.mock("@/lib/billing", () => ({
  preflightCredits: state.preflightCredits,
  reserveAiQuotaHold: state.reserveAiQuotaHold,
  commitAiQuotaHold: state.commitAiQuotaHold,
  releaseAiQuotaHold: state.releaseAiQuotaHold,
  spendCredits: state.spendCredits,
}));

vi.mock("@/lib/billing-errors", () => ({
  mapBillingError: state.mapBillingError,
}));

vi.mock("@/lib/quota-estimation", () => ({
  estimateTokensFromText: state.estimateTokensFromText,
  estimateUpperBoundCredits: state.estimateUpperBoundCredits,
}));

vi.mock("@/lib/org-settings", () => ({
  getOrgModelPolicy: state.getOrgModelPolicy,
  getOrgDlpPolicy: state.getOrgDlpPolicy,
}));

vi.mock("@/lib/ai-authorization", () => ({
  validateModelPolicy: state.validateModelPolicy,
  applyDlpToText: state.applyDlpToText,
}));

vi.mock("@/lib/model-policy", () => ({
  isModelAllowed: state.isModelAllowed,
}));

vi.mock("@/lib/chat-ownership", () => ({
  findOwnedChat: state.findOwnedChat,
}));

vi.mock("@/lib/cost-centers", () => ({
  resolveOrgCostCenterId: state.resolveOrgCostCenterId,
}));

vi.mock("@/lib/telemetry", () => ({
  logEvent: state.logEvent,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: state.logAudit,
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: state.getStripe,
}));

vi.mock("@/lib/stripe-webhook", () => ({
  recordStripeWebhookEvent: state.recordStripeWebhookEvent,
}));

vi.mock("@/lib/http-error", () => ({
  HttpError: class HttpError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("node:fs/promises", () => ({
  readFile: state.readFile,
}));

vi.mock("node:crypto", () => ({
  randomBytes: state.randomBytes,
}));

import { POST as imageDescription } from "@/app/api/ai/image/route";
import { POST as createMessage } from "@/app/api/messages/route";
import { PATCH as updateMessage, DELETE as deleteMessage } from "@/app/api/messages/[id]/route";
import { GET as listChats, POST as createChat } from "@/app/api/chats/route";
import { GET as getChat, PATCH as patchChat, DELETE as deleteChat } from "@/app/api/chats/[id]/route";
import { POST as createShare } from "@/app/api/chats/[id]/share/route";
import { POST as stripeWebhook } from "@/app/api/payments/stripe/webhook/route";

function jsonResponse(res: Response) {
  return res.json() as Promise<any>;
}

describe("ai image route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    delete process.env.STRIPE_WEBHOOK_SECRET;
    state.auth.mockResolvedValue({ user: { id: "user-1" } });
    state.readFile.mockResolvedValue(Buffer.from("image-bytes"));
    state.getUserOpenRouterKey.mockReturnValue("user-key");
    state.getOpenRouterHeaders.mockReturnValue({ Authorization: "Bearer test" });
    state.calculateCreditsFromUsage.mockResolvedValue({ credits: 2 });
    state.preflightCredits.mockResolvedValue(undefined);
    state.reserveAiQuotaHold.mockResolvedValue({ id: "hold-1" });
    state.commitAiQuotaHold.mockResolvedValue(undefined);
    state.releaseAiQuotaHold.mockResolvedValue(undefined);
    state.spendCredits.mockResolvedValue(undefined);
    state.mapBillingError.mockImplementation((message: string) =>
      message === "INSUFFICIENT_BALANCE"
        ? { error: "Insufficient balance", status: 402 }
        : null
    );
    state.estimateUpperBoundCredits.mockResolvedValue(2);
    state.getOrgModelPolicy.mockReturnValue({ allowlist: ["openai/gpt-4o-mini"] });
    state.getOrgDlpPolicy.mockReturnValue({ scope: "ORG" });
    state.validateModelPolicy.mockResolvedValue({ ok: true });
    state.applyDlpToText.mockResolvedValue({ ok: true, content: "safe prompt" });
    state.findOwnedChat.mockResolvedValue({ id: "chat-1" });
    state.resolveOrgCostCenterId.mockResolvedValue("cc-1");
    state.logEvent.mockResolvedValue(undefined);
    state.logAudit.mockResolvedValue(undefined);
    state.isModelAllowed.mockReturnValue(true);
    state.getStripe.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(),
      },
    });
    state.recordStripeWebhookEvent.mockResolvedValue(true);
    state.prisma.attachment.findFirst.mockResolvedValue({
      id: "att-1",
      storagePath: "/tmp/image.png",
      mimeType: "image/png",
      filename: "image.png",
    });
    state.prisma.user.findUnique.mockResolvedValue({
      balance: 100,
      settings: null,
      org: null,
      orgId: null,
      costCenterId: null,
    });
    state.prisma.orgMembership.findUnique.mockResolvedValue({
      id: "membership-1",
      defaultCostCenterId: "cc-1",
    });
    state.prisma.organization.findUnique.mockResolvedValue({ settings: null });
    state.prisma.orgMembershipAllowedCostCenter.count.mockResolvedValue(0);
    state.prisma.orgMembershipAllowedCostCenter.findUnique.mockResolvedValue({
      id: "allowed-1",
    });
    state.prisma.costCenter.findFirst.mockResolvedValue({ id: "cc-1" });
    state.prisma.chat.update.mockResolvedValue({});
    state.prisma.chat.findFirst.mockResolvedValue({
      id: "chat-1",
      userId: "user-1",
      modelId: "openai/gpt-4o-mini",
      source: "WEB",
      shareToken: null,
      messages: [
        { id: "m1", role: "USER", content: "hi", cost: 0, createdAt: new Date(), attachments: [] },
      ],
      attachments: [],
    });
    state.prisma.chat.findMany.mockResolvedValue([{ id: "chat-1" }]);
    state.prisma.chat.create.mockResolvedValue({
      id: "chat-created",
      userId: "user-1",
      title: "Hello",
      modelId: "openai/gpt-4o-mini",
      source: "WEB",
    });
    state.prisma.chat.updateMany.mockResolvedValue({ count: 1 });
    state.prisma.chat.deleteMany.mockResolvedValue({ count: 1 });
    state.prisma.message.create.mockResolvedValue({});
    state.prisma.message.findFirst.mockResolvedValue({
      id: "message-1",
      chatId: "chat-1",
      userId: "user-1",
      content: "old",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      cost: 2,
    });
    state.prisma.message.update.mockResolvedValue({
      id: "message-1",
      chatId: "chat-1",
      userId: "user-1",
      content: "new",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      cost: 2,
    });
    state.prisma.message.deleteMany.mockResolvedValue({ count: 1 });
    state.prisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === "function") {
        return arg({
          user: state.prisma.user,
          transaction: state.prisma.transaction,
        });
      }
      return arg;
    });
    state.prisma.transaction.create.mockResolvedValue({});
  });

  test("returns 401 when unauthenticated", async () => {
    state.auth.mockResolvedValueOnce(null);

    const response = await imageDescription(
      new Request("http://localhost/api/ai/image", {
        method: "POST",
        body: JSON.stringify({ attachmentId: "att-1" }),
      })
    );

    assert.equal(response.status, 401);
    assert.deepEqual(await jsonResponse(response), { error: "Unauthorized" });
  });

  test("returns 404 when the attachment does not exist", async () => {
    state.prisma.attachment.findFirst.mockResolvedValueOnce(null);

    const response = await imageDescription(
      new Request("http://localhost/api/ai/image", {
        method: "POST",
        body: JSON.stringify({ attachmentId: "att-missing" }),
      })
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await jsonResponse(response), { error: "Not found" });
  });

  test("returns 400 for non-image attachments", async () => {
    state.prisma.attachment.findFirst.mockResolvedValueOnce({
      id: "att-1",
      storagePath: "/tmp/doc.txt",
      mimeType: "text/plain",
      filename: "doc.txt",
    });

    const response = await imageDescription(
      new Request("http://localhost/api/ai/image", {
        method: "POST",
        body: JSON.stringify({ attachmentId: "att-1" }),
      })
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await jsonResponse(response), { error: "Not an image" });
  });

  test("returns 400 when costCenterId is provided without organization", async () => {
    const response = await imageDescription(
      new Request("http://localhost/api/ai/image", {
        method: "POST",
        body: JSON.stringify({ attachmentId: "att-1", costCenterId: "cc-1" }),
      })
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await jsonResponse(response), {
      error: "costCenterId requires organization",
    });
  });

  test("allows image description without balance when the request is free", async () => {
    state.prisma.user.findUnique.mockResolvedValueOnce({
      balance: 0,
      settings: null,
      org: null,
      orgId: null,
      costCenterId: null,
      subscription: null,
    });
    state.estimateUpperBoundCredits.mockResolvedValueOnce(0);
    state.calculateCreditsFromUsage.mockResolvedValueOnce({ credits: 0 });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Описание" } }],
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
        )
      )
    );

    const response = await imageDescription(
      new Request("http://localhost/api/ai/image", {
        method: "POST",
        body: JSON.stringify({ attachmentId: "att-1" }),
      })
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await jsonResponse(response), {
      data: { description: "Описание" },
    });
    expect(state.preflightCredits).not.toHaveBeenCalled();
    expect(state.reserveAiQuotaHold).not.toHaveBeenCalled();
    expect(state.spendCredits).not.toHaveBeenCalled();
  });

  test("returns 401 when OpenRouter headers cannot be created", async () => {
    state.getOpenRouterHeaders.mockImplementationOnce(() => {
      throw new Error("OPENROUTER_API_KEY missing");
    });

    const response = await imageDescription(
      new Request("http://localhost/api/ai/image", {
        method: "POST",
        body: JSON.stringify({ attachmentId: "att-1" }),
      })
    );

    assert.equal(response.status, 401);
    assert.deepEqual(await jsonResponse(response), {
      error: "OPENROUTER_API_KEY missing",
    });
    expect(state.releaseAiQuotaHold).toHaveBeenCalledWith({
      hold: { id: "hold-1" },
    });
  });

  test("returns upstream errors when OpenRouter fails", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: vi.fn().mockResolvedValue("service unavailable"),
    });

    const response = await imageDescription(
      new Request("http://localhost/api/ai/image", {
        method: "POST",
        body: JSON.stringify({ attachmentId: "att-1" }),
      })
    );

    assert.equal(response.status, 503);
    assert.deepEqual(await jsonResponse(response), {
      error: "OpenRouter error",
      details: "service unavailable",
    });
  });

  test("creates an image description and stores the assistant message", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "A red cat" } }],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
      }),
    });

    const response = await imageDescription(
      new Request("http://localhost/api/ai/image", {
        method: "POST",
        body: JSON.stringify({
          attachmentId: "att-1",
          chatId: "chat-1",
          prompt: "describe",
        }),
      })
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await jsonResponse(response), {
      data: { description: "A red cat" },
    });
    expect(state.prisma.message.create).toHaveBeenCalledWith({
      data: {
        chatId: "chat-1",
        userId: "user-1",
        costCenterId: undefined,
        role: "ASSISTANT",
        content: "Описание изображения: A red cat",
        tokenCount: 13,
        cost: 2,
        modelId: "openai/gpt-4o-mini",
      },
    });
    expect(state.prisma.chat.update).toHaveBeenCalledWith({
      where: { id: "chat-1" },
      data: { updatedAt: expect.any(Date) },
    });
  });

  test("maps billing reserve failures", async () => {
    state.reserveAiQuotaHold.mockRejectedValueOnce(new Error("INSUFFICIENT_BALANCE"));

    const response = await imageDescription(
      new Request("http://localhost/api/ai/image", {
        method: "POST",
        body: JSON.stringify({ attachmentId: "att-1" }),
      })
    );

    assert.equal(response.status, 402);
    assert.deepEqual(await jsonResponse(response), {
      error: "Insufficient balance",
    });
  });

  test("returns a generic billing error when post-processing fails unexpectedly", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "A red cat" } }],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
      }),
    });
    state.calculateCreditsFromUsage.mockRejectedValueOnce(new Error("boom"));
    state.mapBillingError.mockReturnValueOnce(null);

    const response = await imageDescription(
      new Request("http://localhost/api/ai/image", {
        method: "POST",
        body: JSON.stringify({ attachmentId: "att-1" }),
      })
    );

    assert.equal(response.status, 500);
    assert.deepEqual(await jsonResponse(response), {
      error: "Billing error",
    });
  });

  test("returns 403 when the org membership is missing", async () => {
    state.prisma.user.findUnique.mockResolvedValueOnce({
      balance: 100,
      settings: null,
      org: { settings: null },
      orgId: "org-1",
      costCenterId: null,
    });
    state.prisma.orgMembership.findUnique.mockResolvedValueOnce(null);

    const response = await imageDescription(
      new Request("http://localhost/api/ai/image", {
        method: "POST",
        body: JSON.stringify({ attachmentId: "att-1" }),
      })
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await jsonResponse(response), { error: "Forbidden" });
  });

  test("returns 403 when model policy blocks the request", async () => {
    state.validateModelPolicy.mockResolvedValueOnce({
      ok: false,
      error: "Model blocked",
      status: 403,
    });

    const response = await imageDescription(
      new Request("http://localhost/api/ai/image", {
        method: "POST",
        body: JSON.stringify({ attachmentId: "att-1" }),
      })
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await jsonResponse(response), { error: "Model blocked" });
  });

  test("returns 403 when DLP blocks the prompt", async () => {
    state.applyDlpToText.mockResolvedValueOnce({
      ok: false,
      error: "DLP blocked",
      status: 403,
    });

    const response = await imageDescription(
      new Request("http://localhost/api/ai/image", {
        method: "POST",
        body: JSON.stringify({ attachmentId: "att-1" }),
      })
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await jsonResponse(response), { error: "DLP blocked" });
  });

  test("uses the user OpenRouter key and preflights when quota hold is unavailable", async () => {
    const previousAuthBypass = process.env.AUTH_BYPASS;
    process.env.AUTH_BYPASS = "1";
    try {
      state.reserveAiQuotaHold.mockResolvedValueOnce(null);
      state.preflightCredits.mockResolvedValueOnce(undefined);
      state.calculateCreditsFromUsage.mockResolvedValueOnce({ credits: 0 });
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "A red cat" } }],
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
        }),
      });

      const response = await imageDescription(
        new Request("http://localhost/api/ai/image", {
          method: "POST",
          body: JSON.stringify({ attachmentId: "att-1" }),
        })
      );

      assert.equal(response.status, 200);
      assert.deepEqual(await jsonResponse(response), {
        data: { description: "A red cat" },
      });
      expect(state.getUserOpenRouterKey).toHaveBeenCalledWith(null);
      expect(state.preflightCredits).toHaveBeenCalledWith({
        userId: "user-1",
        minAmount: 2,
      });
    } finally {
      if (previousAuthBypass === undefined) {
        delete process.env.AUTH_BYPASS;
      } else {
        process.env.AUTH_BYPASS = previousAuthBypass;
      }
    }
  });

  test("maps billing errors from the final usage charge", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "A red cat" } }],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
      }),
    });
    state.calculateCreditsFromUsage.mockRejectedValueOnce(new Error("INSUFFICIENT_BALANCE"));
    state.mapBillingError.mockReturnValueOnce({
      error: "Insufficient balance",
      status: 402,
    });

    const response = await imageDescription(
      new Request("http://localhost/api/ai/image", {
        method: "POST",
        body: JSON.stringify({ attachmentId: "att-1" }),
      })
    );

    assert.equal(response.status, 402);
    assert.deepEqual(await jsonResponse(response), {
      error: "Insufficient balance",
    });
  });
});

describe("messages routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auth.mockResolvedValue({ user: { id: "user-1" } });
    state.prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      costCenterId: "cc-user",
      orgId: "org-1",
    });
    state.prisma.orgMembership.findUnique.mockResolvedValue({
      id: "membership-1",
      defaultCostCenterId: "cc-1",
    });
    state.prisma.organization.findUnique.mockResolvedValue({
      settings: { dlp: "on" },
    });
    state.prisma.orgMembershipAllowedCostCenter.count.mockResolvedValue(1);
    state.prisma.orgMembershipAllowedCostCenter.findUnique.mockResolvedValue({
      id: "allowed-1",
    });
    state.prisma.costCenter.findFirst.mockResolvedValue({ id: "cc-1" });
    state.prisma.chat.findFirst.mockResolvedValue({
      id: "chat-1",
      modelId: "openai/gpt-4o-mini",
    });
    state.applyDlpToText.mockResolvedValue({ ok: true, content: "safe message" });
    state.preflightCredits.mockResolvedValue(undefined);
    state.reserveAiQuotaHold.mockResolvedValue({ id: "hold-1" });
    state.commitAiQuotaHold.mockResolvedValue(undefined);
    state.releaseAiQuotaHold.mockResolvedValue(undefined);
    state.spendCredits.mockResolvedValue(undefined);
    state.mapBillingError.mockImplementation((message: string) =>
      message === "INSUFFICIENT_BALANCE"
        ? { error: "Insufficient balance", status: 402 }
        : null
    );
    state.logEvent.mockResolvedValue(undefined);
    state.prisma.message.create.mockResolvedValue({
      id: "message-1",
      chatId: "chat-1",
      userId: "user-1",
      content: "safe message",
      cost: 3,
      tokenCount: 11,
    });
  });

  test("returns 401 when unauthenticated", async () => {
    state.auth.mockResolvedValueOnce(null);

    const response = await createMessage(
      new Request("http://localhost/api/messages", {
        method: "POST",
        body: JSON.stringify({
          chatId: "chat-1",
          role: "USER",
          content: "hello",
          tokenCount: 1,
        }),
      })
    );

    assert.equal(response.status, 401);
    assert.deepEqual(await jsonResponse(response), { error: "Unauthorized" });
  });

  test("blocks USER content when DLP rejects it", async () => {
    state.applyDlpToText.mockResolvedValueOnce({
      ok: false,
      error: "DLP blocked",
      status: 403,
    });

    const response = await createMessage(
      new Request("http://localhost/api/messages", {
        method: "POST",
        body: JSON.stringify({
          chatId: "chat-1",
          role: "USER",
          content: "secret",
          tokenCount: 1,
        }),
      })
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await jsonResponse(response), { error: "DLP blocked" });
  });

  test("creates billable USER messages and resolves organization cost center", async () => {
    const response = await createMessage(
      new Request("http://localhost/api/messages", {
        method: "POST",
        body: JSON.stringify({
          chatId: "chat-1",
          role: "USER",
          content: "hello",
          tokenCount: 11,
          cost: 3,
        }),
      })
    );

    assert.equal(response.status, 201);
    assert.deepEqual(await jsonResponse(response), {
      data: {
        id: "message-1",
        chatId: "chat-1",
        userId: "user-1",
        content: "safe message",
        cost: "3",
        tokenCount: 11,
      },
    });
    expect(state.prisma.message.create).toHaveBeenCalledWith({
      data: {
        chatId: "chat-1",
        userId: "user-1",
        costCenterId: "cc-1",
        role: "USER",
        content: "safe message",
        tokenCount: 11,
        cost: 3,
        modelId: "openai/gpt-4o-mini",
      },
    });
  });

  test("creates assistant messages without DLP or billing", async () => {
    state.applyDlpToText.mockClear();
    state.reserveAiQuotaHold.mockClear();
    state.commitAiQuotaHold.mockClear();
    state.releaseAiQuotaHold.mockClear();
    state.preflightCredits.mockClear();
    state.spendCredits.mockClear();

    const response = await createMessage(
      new Request("http://localhost/api/messages", {
        method: "POST",
        body: JSON.stringify({
          chatId: "chat-1",
          role: "ASSISTANT",
          content: "ok",
          tokenCount: 2,
        }),
      })
    );

    assert.equal(response.status, 201);
    expect(state.reserveAiQuotaHold).not.toHaveBeenCalled();
    expect(state.prisma.message.create).toHaveBeenCalledWith({
      data: {
        chatId: "chat-1",
        userId: "user-1",
        costCenterId: "cc-1",
        role: "ASSISTANT",
        content: "ok",
        tokenCount: 2,
        cost: 0,
        modelId: "openai/gpt-4o-mini",
      },
    });
  });

  test("returns 404 when the chat does not exist", async () => {
    state.prisma.chat.findFirst.mockResolvedValueOnce(null);

    const response = await createMessage(
      new Request("http://localhost/api/messages", {
        method: "POST",
        body: JSON.stringify({
          chatId: "chat-404",
          role: "ASSISTANT",
          content: "ok",
          tokenCount: 2,
        }),
      })
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await jsonResponse(response), { error: "Chat not found" });
  });

  test("maps billing failures and logs them", async () => {
    state.spendCredits.mockRejectedValueOnce(new Error("INSUFFICIENT_BALANCE"));

    const response = await createMessage(
      new Request("http://localhost/api/messages", {
        method: "POST",
        body: JSON.stringify({
          chatId: "chat-1",
          role: "USER",
          content: "hello",
          tokenCount: 3,
          cost: 5,
        }),
      })
    );

    assert.equal(response.status, 402);
    assert.deepEqual(await jsonResponse(response), {
      error: "Insufficient balance",
    });
    expect(state.logEvent).toHaveBeenCalledWith({
      type: "BILLING_ERROR",
      userId: "user-1",
      chatId: "chat-1",
      message: "INSUFFICIENT_BALANCE",
    });
    expect(state.releaseAiQuotaHold).toHaveBeenCalledWith({
      hold: { id: "hold-1" },
    });
  });

  test("preflights credits when the quota hold cannot be reserved", async () => {
    state.reserveAiQuotaHold.mockResolvedValueOnce(null);
    state.prisma.message.create.mockResolvedValueOnce({
      id: "message-2",
      chatId: "chat-1",
      userId: "user-1",
      content: "safe message",
      cost: 5,
      tokenCount: 11,
    });

    const response = await createMessage(
      new Request("http://localhost/api/messages", {
        method: "POST",
        body: JSON.stringify({
          chatId: "chat-1",
          role: "USER",
          content: "hello",
          tokenCount: 11,
          cost: 5,
        }),
      })
    );

    assert.equal(response.status, 201);
    expect(state.preflightCredits).toHaveBeenCalledWith({
      userId: "user-1",
      minAmount: 1,
    });
  });

  test("maps billing errors when quota reservation fails", async () => {
    state.reserveAiQuotaHold.mockRejectedValueOnce(new Error("INSUFFICIENT_BALANCE"));

    const response = await createMessage(
      new Request("http://localhost/api/messages", {
        method: "POST",
        body: JSON.stringify({
          chatId: "chat-1",
          role: "USER",
          content: "hello",
          tokenCount: 11,
          cost: 5,
        }),
      })
    );

    assert.equal(response.status, 402);
    assert.deepEqual(await jsonResponse(response), {
      error: "Insufficient balance",
    });
  });
});

describe("message id route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("PATCH returns 401 when unauthenticated", async () => {
    state.auth.mockResolvedValueOnce(null);

    const response = await updateMessage(
      new Request("http://localhost/api/messages/message-1", {
        method: "PATCH",
        body: JSON.stringify({ content: "new" }),
      }),
      { params: Promise.resolve({ id: "message-1" }) }
    );

    assert.equal(response.status, 401);
    assert.deepEqual(await jsonResponse(response), { error: "Unauthorized" });
  });

  test("PATCH updates message and rolls back later messages", async () => {
    const response = await updateMessage(
      new Request("http://localhost/api/messages/message-1", {
        method: "PATCH",
        body: JSON.stringify({ content: "new", rollback: true }),
      }),
      { params: Promise.resolve({ id: "message-1" }) }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await jsonResponse(response), {
      data: {
        id: "message-1",
        chatId: "chat-1",
        userId: "user-1",
        content: "new",
        createdAt: "2025-01-01T00:00:00.000Z",
        cost: "2",
      },
    });
    expect(state.prisma.message.update).toHaveBeenCalledWith({
      where: { id: "message-1" },
      data: { content: "new" },
    });
    expect(state.prisma.message.deleteMany).toHaveBeenCalledWith({
      where: {
        chatId: "chat-1",
        userId: "user-1",
        createdAt: { gt: new Date("2025-01-01T00:00:00.000Z") },
      },
    });
  });

  test("PATCH returns 404 when the message is missing", async () => {
    state.prisma.message.findFirst.mockResolvedValueOnce(null);

    const response = await updateMessage(
      new Request("http://localhost/api/messages/message-404", {
        method: "PATCH",
        body: JSON.stringify({ content: "new" }),
      }),
      { params: Promise.resolve({ id: "message-404" }) }
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await jsonResponse(response), { error: "Not found" });
  });

  test("DELETE returns 401 when unauthenticated", async () => {
    state.auth.mockResolvedValueOnce(null);

    const response = await deleteMessage(
      new Request("http://localhost/api/messages/message-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "message-1" }) }
    );

    assert.equal(response.status, 401);
    assert.deepEqual(await jsonResponse(response), { error: "Unauthorized" });
  });

  test("DELETE removes the owned message", async () => {
    const response = await deleteMessage(
      new Request("http://localhost/api/messages/message-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "message-1" }) }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await jsonResponse(response), { success: true });
    expect(state.prisma.message.deleteMany).toHaveBeenCalledWith({
      where: { id: "message-1", userId: "user-1" },
    });
  });
});

describe("chats route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auth.mockResolvedValue({ user: { id: "user-1" } });
    state.prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      orgId: "org-1",
      org: { settings: { modelPolicy: "allow" } },
    });
    state.isModelAllowed.mockReturnValue(true);
  });

  test("GET returns 401 when unauthenticated", async () => {
    state.auth.mockResolvedValueOnce(null);

    const response = await listChats(
      new Request("http://localhost/api/chats", { method: "GET" })
    );

    assert.equal(response.status, 401);
    assert.deepEqual(await jsonResponse(response), { error: "Unauthorized" });
  });

  test("GET applies the search query and returns chats", async () => {
    state.prisma.chat.findMany.mockResolvedValueOnce([{ id: "chat-1" }]);

    const response = await listChats(
      new Request("http://localhost/api/chats?query=hello", { method: "GET" })
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await jsonResponse(response), { data: [{ id: "chat-1" }] });
    expect(state.prisma.chat.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        OR: [
          { title: { contains: "hello", mode: "insensitive" } },
          {
            messages: {
              some: {
                content: { contains: "hello", mode: "insensitive" },
              },
            },
          },
        ],
      },
      orderBy: { updatedAt: "desc" },
    });
  });

  test("GET without query returns the user's chats", async () => {
    state.prisma.chat.findMany.mockResolvedValueOnce([{ id: "chat-2" }]);

    const response = await listChats(
      new Request("http://localhost/api/chats", { method: "GET" })
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await jsonResponse(response), { data: [{ id: "chat-2" }] });
    expect(state.prisma.chat.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { updatedAt: "desc" },
    });
  });

  test("POST blocks models forbidden by organization policy", async () => {
    state.isModelAllowed.mockReturnValueOnce(false);

    const response = await createChat(
      new Request("http://localhost/api/chats", {
        method: "POST",
        body: JSON.stringify({ title: "New chat", modelId: "blocked/model" }),
      })
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await jsonResponse(response), {
      error: "Модель запрещена политикой организации.",
    });
    expect(state.logAudit).toHaveBeenCalledWith({
      action: "POLICY_BLOCKED",
      orgId: "org-1",
      actorId: "user-1",
      targetType: "model",
      targetId: "blocked/model",
      metadata: { reason: "blocked_by_policy" },
    });
  });

  test("POST creates a chat when the model is allowed", async () => {
    const response = await createChat(
      new Request("http://localhost/api/chats", {
        method: "POST",
        body: JSON.stringify({ title: "New chat", modelId: "openai/gpt-4o" }),
      })
    );

    assert.equal(response.status, 201);
    assert.deepEqual(await jsonResponse(response), {
      data: {
        id: "chat-created",
        userId: "user-1",
        title: "Hello",
        modelId: "openai/gpt-4o-mini",
        source: "WEB",
      },
    });
    expect(state.prisma.chat.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        title: "New chat",
        modelId: "openai/gpt-4o",
        source: "WEB",
      },
    });
  });
});

describe("chat id route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("GET returns 404 for unknown chats", async () => {
    state.prisma.chat.findFirst.mockResolvedValueOnce(null);

    const response = await getChat(
      new Request("http://localhost/api/chats/chat-1", { method: "GET" }),
      { params: Promise.resolve({ id: "chat-1" }) }
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await jsonResponse(response), { error: "Not found" });
  });

  test("GET serializes messages and attachments", async () => {
    state.prisma.chat.findFirst.mockResolvedValueOnce({
      id: "chat-1",
      userId: "user-1",
      title: "Chat",
      messages: [
        { id: "m1", cost: 5, content: "hello", createdAt: new Date("2025-02-01T00:00:00.000Z") },
      ],
      attachments: [
        {
          id: "att-1",
          filename: "doc.txt",
          mimeType: "text/plain",
          size: 12,
          textContent: "body",
          createdAt: new Date("2025-02-01T00:00:00.000Z"),
        },
      ],
    });

    const response = await getChat(
      new Request("http://localhost/api/chats/chat-1", { method: "GET" }),
      { params: Promise.resolve({ id: "chat-1" }) }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await jsonResponse(response), {
      data: {
        id: "chat-1",
        userId: "user-1",
        title: "Chat",
        messages: [
          {
            id: "m1",
            cost: "5",
            content: "hello",
            createdAt: "2025-02-01T00:00:00.000Z",
          },
        ],
        attachments: [
          {
            id: "att-1",
            filename: "doc.txt",
            mimeType: "text/plain",
            size: 12,
            createdAt: "2025-02-01T00:00:00.000Z",
            hasText: true,
          },
        ],
      },
    });
  });

  test("PATCH updates an owned chat", async () => {
    const response = await patchChat(
      new Request("http://localhost/api/chats/chat-1", {
        method: "PATCH",
        body: JSON.stringify({ title: "Renamed", pinned: true }),
      }),
      { params: Promise.resolve({ id: "chat-1" }) }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await jsonResponse(response), { success: true });
    expect(state.prisma.chat.updateMany).toHaveBeenCalledWith({
      where: { id: "chat-1", userId: "user-1" },
      data: { title: "Renamed", pinned: true },
    });
  });

  test("PATCH returns 404 when the chat is missing", async () => {
    state.prisma.chat.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await patchChat(
      new Request("http://localhost/api/chats/chat-404", {
        method: "PATCH",
        body: JSON.stringify({ title: "Renamed" }),
      }),
      { params: Promise.resolve({ id: "chat-404" }) }
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await jsonResponse(response), { error: "Not found" });
  });

  test("DELETE removes chat messages and the chat itself", async () => {
    const response = await deleteChat(
      new Request("http://localhost/api/chats/chat-1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "chat-1" }) }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await jsonResponse(response), { success: true });
    expect(state.prisma.$transaction).toHaveBeenCalled();
  });
});

describe("share route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  });

  test("POST returns 401 when unauthenticated", async () => {
    state.auth.mockResolvedValueOnce(null);

    const response = await createShare(
      new Request("http://localhost/api/chats/chat-1/share", { method: "POST" }),
      { params: Promise.resolve({ id: "chat-1" }) }
    );

    assert.equal(response.status, 401);
    assert.deepEqual(await jsonResponse(response), { error: "Unauthorized" });
  });

  test("POST creates a share token for chats without one", async () => {
    state.prisma.chat.findFirst.mockResolvedValueOnce({
      id: "chat-1",
      shareToken: null,
    });

    const response = await createShare(
      new Request("http://localhost/api/chats/chat-1/share", { method: "POST" }),
      { params: Promise.resolve({ id: "chat-1" }) }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await jsonResponse(response), {
      data: {
        shareToken: "0123456789abcdef0123456789abcdef",
        url: "http://localhost:3000/share/0123456789abcdef0123456789abcdef",
      },
    });
    expect(state.prisma.chat.update).toHaveBeenCalledWith({
      where: { id: "chat-1" },
      data: { shareToken: "0123456789abcdef0123456789abcdef" },
    });
  });

  test("POST returns 404 when the chat is missing", async () => {
    state.prisma.chat.findFirst.mockResolvedValueOnce(null);

    const response = await createShare(
      new Request("http://localhost/api/chats/chat-404/share", { method: "POST" }),
      { params: Promise.resolve({ id: "chat-404" }) }
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await jsonResponse(response), { error: "Not found" });
  });

  test("POST reuses an existing share token", async () => {
    state.prisma.chat.findFirst.mockResolvedValueOnce({
      id: "chat-1",
      shareToken: "existing-token",
    });

    const response = await createShare(
      new Request("http://localhost/api/chats/chat-1/share", { method: "POST" }),
      { params: Promise.resolve({ id: "chat-1" }) }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await jsonResponse(response), {
      data: {
        shareToken: "existing-token",
        url: "http://localhost:3000/share/existing-token",
      },
    });
  });
});

describe("stripe webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  });

  test("returns 400 when the signature is missing", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const response = await stripeWebhook(
      new Request("http://localhost/api/payments/stripe/webhook", {
        method: "POST",
        body: "payload",
      })
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await jsonResponse(response), { error: "Missing signature" });
  });

  test("returns 500 when the webhook secret is not configured", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const response = await stripeWebhook(
      new Request("http://localhost/api/payments/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig" },
        body: "payload",
      })
    );

    assert.equal(response.status, 500);
    assert.deepEqual(await jsonResponse(response), {
      error: "Webhook secret not set",
    });
  });

  test("returns 400 when the signature is invalid", async () => {
    const stripe = state.getStripe();
    stripe.webhooks.constructEvent.mockImplementationOnce(() => {
      throw new Error("invalid signature");
    });

    const response = await stripeWebhook(
      new Request("http://localhost/api/payments/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig" },
        body: "payload",
      })
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await jsonResponse(response), { error: "invalid signature" });
  });

  test("records checkout completions and credits the user", async () => {
    const stripe = state.getStripe();
    stripe.webhooks.constructEvent.mockReturnValueOnce({
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          metadata: { credits: "50", userId: "user-1" },
        },
      },
    });
    state.recordStripeWebhookEvent.mockResolvedValueOnce(true);
    state.prisma.user.findUnique.mockResolvedValueOnce({
      costCenterId: "cc-1",
    });

    const response = await stripeWebhook(
      new Request("http://localhost/api/payments/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig" },
        body: "payload",
      })
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await jsonResponse(response), { received: true });
    expect(state.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { balance: { increment: 50 } },
    });
    expect(state.prisma.transaction.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        costCenterId: "cc-1",
        amount: 50,
        type: "REFILL",
        description: "Stripe пополнение",
        externalId: "evt_1",
      },
    });
  });

  test("ignores duplicate checkout completions", async () => {
    const stripe = state.getStripe();
    stripe.webhooks.constructEvent.mockReturnValueOnce({
      id: "evt_2",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_2",
          metadata: { credits: "10", userId: "user-1" },
        },
      },
    });
    state.recordStripeWebhookEvent.mockResolvedValueOnce(false);

    const response = await stripeWebhook(
      new Request("http://localhost/api/payments/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig" },
        body: "payload",
      })
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await jsonResponse(response), { received: true });
  });
});
