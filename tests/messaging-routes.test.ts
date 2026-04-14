import assert from "node:assert/strict";
import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    orgMembership: {
      findUnique: vi.fn(),
    },
    orgMembershipAllowedCostCenter: {
      count: vi.fn(),
      findUnique: vi.fn(),
    },
    costCenter: {
      findFirst: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
    },
    chat: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    message: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  getOrgDlpPolicy: vi.fn(),
  getOrgModelPolicy: vi.fn(),
  isModelAllowed: vi.fn(),
  applyDlpToText: vi.fn(),
  preflightCredits: vi.fn(),
  reserveAiQuotaHold: vi.fn(),
  commitAiQuotaHold: vi.fn(),
  releaseAiQuotaHold: vi.fn(),
  spendCredits: vi.fn(),
  mapBillingError: vi.fn(),
  logEvent: vi.fn(),
  logAudit: vi.fn(),
  recordStripeWebhookEvent: vi.fn(),
  getStripe: vi.fn(),
  randomBytes: vi.fn(() => Buffer.from("0102030405060708090a0b0c0d0e0f10", "hex")),
}));

vi.mock("@/lib/auth", () => ({
  auth: state.auth,
}));

vi.mock("@/lib/db", () => ({
  prisma: state.prisma,
}));

vi.mock("@/lib/org-settings", () => ({
  getOrgDlpPolicy: state.getOrgDlpPolicy,
  getOrgModelPolicy: state.getOrgModelPolicy,
}));

vi.mock("@/lib/model-policy", () => ({
  isModelAllowed: state.isModelAllowed,
}));

vi.mock("@/lib/ai-authorization", () => ({
  applyDlpToText: state.applyDlpToText,
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

vi.mock("@/lib/telemetry", () => ({
  logEvent: state.logEvent,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: state.logAudit,
}));

vi.mock("@/lib/stripe-webhook", () => ({
  recordStripeWebhookEvent: state.recordStripeWebhookEvent,
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: state.getStripe,
}));

vi.mock("node:crypto", () => ({
  randomBytes: state.randomBytes,
}));

import { PATCH as patchMessage, DELETE as deleteMessage } from "@/app/api/messages/[id]/route";
import { POST as createMessage } from "@/app/api/messages/route";
import { GET as getChats, POST as createChat } from "@/app/api/chats/route";
import {
  GET as getChat,
  PATCH as patchChat,
  DELETE as deleteChat,
} from "@/app/api/chats/[id]/route";
import { POST as shareChat } from "@/app/api/chats/[id]/share/route";
import { POST as stripeWebhook } from "@/app/api/payments/stripe/webhook/route";

function jsonResponse(res: Response) {
  return res.json() as Promise<any>;
}

describe("messaging routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

    state.auth.mockResolvedValue({ user: { id: "user-1" } });
    state.getOrgDlpPolicy.mockReturnValue({ scope: "ORG" });
    state.getOrgModelPolicy.mockReturnValue({ allowlist: ["openai/gpt-4o-mini"] });
    state.isModelAllowed.mockReturnValue(true);
    state.applyDlpToText.mockResolvedValue({ ok: true, content: "sanitized text" });
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
    state.logAudit.mockResolvedValue(undefined);
    state.recordStripeWebhookEvent.mockResolvedValue(true);
    state.getStripe.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(),
      },
    });

    state.prisma.user.findUnique.mockResolvedValue({
      balance: 100,
      orgId: null,
      costCenterId: null,
      settings: null,
      org: null,
    });
    state.prisma.orgMembership.findUnique.mockResolvedValue(null);
    state.prisma.orgMembershipAllowedCostCenter.count.mockResolvedValue(0);
    state.prisma.orgMembershipAllowedCostCenter.findUnique.mockResolvedValue(null);
    state.prisma.costCenter.findFirst.mockResolvedValue(null);
    state.prisma.organization.findUnique.mockResolvedValue({ settings: null });
    state.prisma.chat.findFirst.mockResolvedValue({ id: "chat-1", modelId: "m-1" });
    state.prisma.chat.findMany.mockResolvedValue([]);
    state.prisma.chat.create.mockResolvedValue({
      id: "chat-1",
      title: "Chat",
      modelId: "openai/gpt-4o-mini",
      source: "WEB",
    });
    state.prisma.chat.updateMany.mockResolvedValue({ count: 1 });
    state.prisma.chat.update.mockResolvedValue({});
    state.prisma.chat.deleteMany.mockResolvedValue({});
    state.prisma.message.create.mockResolvedValue({
      id: "message-1",
      chatId: "chat-1",
      userId: "user-1",
      role: "USER",
      content: "sanitized text",
      tokenCount: 10,
      cost: 3,
      modelId: "m-1",
      createdAt: new Date("2026-04-14T00:00:00.000Z"),
    });
    state.prisma.message.findFirst.mockResolvedValue({
      id: "message-1",
      chatId: "chat-1",
      userId: "user-1",
      cost: 3,
      createdAt: new Date("2026-04-14T00:00:00.000Z"),
    });
    state.prisma.message.update.mockResolvedValue({
      id: "message-1",
      chatId: "chat-1",
      userId: "user-1",
      cost: 3,
      createdAt: new Date("2026-04-14T00:00:00.000Z"),
    });
    state.prisma.message.deleteMany.mockResolvedValue({});
    state.prisma.$transaction.mockImplementation(async (arg: any) => {
      if (typeof arg === "function") {
        return arg({
          message: state.prisma.message,
          chat: state.prisma.chat,
        });
      }
      return arg;
    });
  });

  describe("PATCH /api/messages/[id]", () => {
    test("returns 401 when unauthenticated", async () => {
      state.auth.mockResolvedValueOnce(null);

      const response = await patchMessage(
        new Request("http://localhost/api/messages/message-1", {
          method: "PATCH",
          body: JSON.stringify({ content: "updated" }),
        }),
        { params: Promise.resolve({ id: "message-1" }) }
      );

      assert.equal(response.status, 401);
      assert.deepEqual(await jsonResponse(response), { error: "Unauthorized" });
    });

    test("returns 404 when the message does not belong to the user", async () => {
      state.prisma.message.findFirst.mockResolvedValueOnce(null);

      const response = await patchMessage(
        new Request("http://localhost/api/messages/message-1", {
          method: "PATCH",
          body: JSON.stringify({ content: "updated" }),
        }),
        { params: Promise.resolve({ id: "message-1" }) }
      );

      assert.equal(response.status, 404);
      assert.deepEqual(await jsonResponse(response), { error: "Not found" });
    });

    test("updates content and rolls back later messages", async () => {
      const response = await patchMessage(
        new Request("http://localhost/api/messages/message-1", {
          method: "PATCH",
          body: JSON.stringify({ content: "updated", rollback: true }),
        }),
        { params: Promise.resolve({ id: "message-1" }) }
      );

      assert.equal(response.status, 200);
      assert.deepEqual(await jsonResponse(response), {
        data: {
          id: "message-1",
          chatId: "chat-1",
          userId: "user-1",
          cost: "3",
          createdAt: "2026-04-14T00:00:00.000Z",
        },
      });
      expect(state.prisma.message.update).toHaveBeenCalledWith({
        where: { id: "message-1" },
        data: { content: "updated" },
      });
      expect(state.prisma.message.deleteMany).toHaveBeenCalledWith({
        where: {
          chatId: "chat-1",
          userId: "user-1",
          createdAt: { gt: new Date("2026-04-14T00:00:00.000Z") },
        },
      });
    });
  });

  describe("POST /api/messages", () => {
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

    test("returns 404 when the chat is missing", async () => {
      state.prisma.chat.findFirst.mockResolvedValueOnce(null);

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

      assert.equal(response.status, 404);
      assert.deepEqual(await jsonResponse(response), { error: "Chat not found" });
    });

    test("maps billing reserve failures", async () => {
      state.reserveAiQuotaHold.mockRejectedValueOnce(new Error("INSUFFICIENT_BALANCE"));

      const response = await createMessage(
        new Request("http://localhost/api/messages", {
          method: "POST",
          body: JSON.stringify({
            chatId: "chat-1",
            role: "USER",
            content: "hello",
            tokenCount: 1,
            cost: 5,
          }),
        })
      );

      assert.equal(response.status, 402);
      assert.deepEqual(await jsonResponse(response), {
        error: "Insufficient balance",
      });
    });

    test("creates a message with org cost center and DLP content", async () => {
      state.prisma.user.findUnique.mockResolvedValueOnce({
        balance: 100,
        orgId: "org-1",
        costCenterId: "cc-user",
        settings: null,
        org: { settings: null },
      });
      state.prisma.orgMembership.findUnique.mockResolvedValueOnce({
        id: "membership-1",
        defaultCostCenterId: "cc-1",
      });
      state.prisma.orgMembershipAllowedCostCenter.count.mockResolvedValueOnce(1);
      state.prisma.orgMembershipAllowedCostCenter.findUnique.mockResolvedValueOnce({
        id: "allowed-1",
      });
      state.prisma.costCenter.findFirst.mockResolvedValueOnce({ id: "cc-1" });
      state.prisma.organization.findUnique.mockResolvedValueOnce({ settings: null });
      state.applyDlpToText.mockResolvedValueOnce({
        ok: true,
        content: "sanitized text",
      });
      state.reserveAiQuotaHold.mockResolvedValueOnce({ id: "hold-org-1" });
      state.spendCredits.mockResolvedValueOnce(undefined);
      state.prisma.message.create.mockResolvedValueOnce({
        id: "message-2",
        chatId: "chat-1",
        userId: "user-1",
        cost: 5,
        createdAt: new Date("2026-04-14T00:00:00.000Z"),
      });

      const response = await createMessage(
        new Request("http://localhost/api/messages", {
          method: "POST",
          body: JSON.stringify({
            chatId: "chat-1",
            role: "USER",
            content: "secret",
            tokenCount: 1,
            cost: 5,
          }),
        })
      );

      assert.equal(response.status, 201);
      assert.deepEqual(await jsonResponse(response), {
        data: {
          id: "message-2",
          chatId: "chat-1",
          userId: "user-1",
          cost: "5",
          createdAt: "2026-04-14T00:00:00.000Z",
        },
      });
      expect(state.applyDlpToText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "secret",
          audit: {
            orgId: "org-1",
            actorId: "user-1",
            targetId: "chat-1",
          },
        })
      );
      expect(state.prisma.message.create).toHaveBeenCalledWith({
        data: {
          chatId: "chat-1",
          userId: "user-1",
          costCenterId: "cc-1",
          role: "USER",
          content: "sanitized text",
          tokenCount: 1,
          cost: 5,
          modelId: "m-1",
        },
      });
    });
  });

  describe("DELETE /api/messages/[id]", () => {
    test("returns 401 when unauthenticated", async () => {
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

    test("deletes the message for the authenticated user", async () => {
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

  describe("GET /api/chats", () => {
    test("returns 401 when unauthenticated", async () => {
      state.auth.mockResolvedValueOnce(null);

      const response = await getChats(new Request("http://localhost/api/chats"));

      assert.equal(response.status, 401);
      assert.deepEqual(await jsonResponse(response), { error: "Unauthorized" });
    });

    test("filters by query when provided", async () => {
      state.prisma.chat.findMany.mockResolvedValueOnce([{ id: "chat-1" }]);

      const response = await getChats(
        new Request("http://localhost/api/chats?query=hello")
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
  });

  describe("POST /api/chats", () => {
    test("returns 403 when the model is blocked by policy", async () => {
      state.isModelAllowed.mockReturnValueOnce(false);

      const response = await createChat(
        new Request("http://localhost/api/chats", {
          method: "POST",
          body: JSON.stringify({ title: "Chat", modelId: "blocked-model" }),
        })
      );

      assert.equal(response.status, 403);
      assert.deepEqual(await jsonResponse(response), {
        error: "Модель запрещена политикой организации.",
      });
      expect(state.logAudit).toHaveBeenCalledWith({
        action: "POLICY_BLOCKED",
        orgId: null,
        actorId: "user-1",
        targetType: "model",
        targetId: "blocked-model",
        metadata: { reason: "blocked_by_policy" },
      });
    });

    test("creates a chat when the model is allowed", async () => {
      state.prisma.chat.create.mockResolvedValueOnce({
        id: "chat-2",
        title: "Chat",
        modelId: "openai/gpt-4o-mini",
        source: "WEB",
      });

      const response = await createChat(
        new Request("http://localhost/api/chats", {
          method: "POST",
          body: JSON.stringify({
            title: "Chat",
            modelId: "openai/gpt-4o-mini",
          }),
        })
      );

      assert.equal(response.status, 201);
      assert.deepEqual(await jsonResponse(response), {
        data: {
          id: "chat-2",
          title: "Chat",
          modelId: "openai/gpt-4o-mini",
          source: "WEB",
        },
      });
      expect(state.prisma.chat.create).toHaveBeenCalledWith({
        data: {
          userId: "user-1",
          title: "Chat",
          modelId: "openai/gpt-4o-mini",
          source: "WEB",
        },
      });
    });
  });

  describe("GET /api/chats/[id]", () => {
    test("returns 404 when the chat does not exist", async () => {
      state.prisma.chat.findFirst.mockResolvedValueOnce(null);

      const response = await getChat(
        new Request("http://localhost/api/chats/chat-1"),
        { params: Promise.resolve({ id: "chat-1" }) }
      );

      assert.equal(response.status, 404);
      assert.deepEqual(await jsonResponse(response), { error: "Not found" });
    });

    test("serializes messages and attachments", async () => {
      state.prisma.chat.findFirst.mockResolvedValueOnce({
        id: "chat-1",
        messages: [
          {
            id: "msg-1",
            cost: 4,
            createdAt: new Date("2026-04-14T00:00:00.000Z"),
          },
        ],
        attachments: [
          {
            id: "att-1",
            filename: "file.txt",
            mimeType: "text/plain",
            size: 12,
            createdAt: new Date("2026-04-14T00:00:00.000Z"),
            textContent: "hello",
          },
        ],
      });

      const response = await getChat(
        new Request("http://localhost/api/chats/chat-1"),
        { params: Promise.resolve({ id: "chat-1" }) }
      );

      assert.equal(response.status, 200);
      assert.deepEqual(await jsonResponse(response), {
        data: {
          id: "chat-1",
          messages: [
            {
              id: "msg-1",
              cost: "4",
              createdAt: "2026-04-14T00:00:00.000Z",
            },
          ],
          attachments: [
            {
              id: "att-1",
              filename: "file.txt",
              mimeType: "text/plain",
              size: 12,
              createdAt: "2026-04-14T00:00:00.000Z",
              hasText: true,
            },
          ],
        },
      });
    });
  });

  describe("PATCH /api/chats/[id]", () => {
    test("returns 404 when the chat does not exist", async () => {
      state.prisma.chat.updateMany.mockResolvedValueOnce({ count: 0 });

      const response = await patchChat(
        new Request("http://localhost/api/chats/chat-1", {
          method: "PATCH",
          body: JSON.stringify({ title: "Updated" }),
        }),
        { params: Promise.resolve({ id: "chat-1" }) }
      );

      assert.equal(response.status, 404);
      assert.deepEqual(await jsonResponse(response), { error: "Not found" });
    });

    test("updates a chat for the owner", async () => {
      const response = await patchChat(
        new Request("http://localhost/api/chats/chat-1", {
          method: "PATCH",
          body: JSON.stringify({
            title: "Updated",
            pinned: true,
            isFavorite: false,
          }),
        }),
        { params: Promise.resolve({ id: "chat-1" }) }
      );

      assert.equal(response.status, 200);
      assert.deepEqual(await jsonResponse(response), { success: true });
      expect(state.prisma.chat.updateMany).toHaveBeenCalledWith({
        where: { id: "chat-1", userId: "user-1" },
        data: {
          title: "Updated",
          pinned: true,
          isFavorite: false,
        },
      });
    });
  });

  describe("DELETE /api/chats/[id]", () => {
    test("deletes chat and its messages", async () => {
      const response = await deleteChat(
        new Request("http://localhost/api/chats/chat-1", {
          method: "DELETE",
        }),
        { params: Promise.resolve({ id: "chat-1" }) }
      );

      assert.equal(response.status, 200);
      assert.deepEqual(await jsonResponse(response), { success: true });
      expect(state.prisma.$transaction).toHaveBeenCalledTimes(1);
      const [ops] = state.prisma.$transaction.mock.calls[0];
      expect(Array.isArray(ops)).toBe(true);
      expect(ops).toHaveLength(2);
    });
  });

  describe("POST /api/chats/[id]/share", () => {
    test("returns 404 when the chat is missing", async () => {
      state.prisma.chat.findFirst.mockResolvedValueOnce(null);

      const response = await shareChat(
        new Request("http://localhost/api/chats/chat-1/share", {
          method: "POST",
        }),
        { params: Promise.resolve({ id: "chat-1" }) }
      );

      assert.equal(response.status, 404);
      assert.deepEqual(await jsonResponse(response), { error: "Not found" });
    });

    test("reuses an existing share token without updating the record", async () => {
      state.prisma.chat.findFirst.mockResolvedValueOnce({
        id: "chat-1",
        shareToken: "existing-token",
      });

      const response = await shareChat(
        new Request("http://localhost/api/chats/chat-1/share", {
          method: "POST",
        }),
        { params: Promise.resolve({ id: "chat-1" }) }
      );

      assert.equal(response.status, 200);
      assert.deepEqual(await jsonResponse(response), {
        data: {
          shareToken: "existing-token",
          url: "http://localhost:3000/share/existing-token",
        },
      });
      expect(state.prisma.chat.update).not.toHaveBeenCalled();
    });

    test("creates a share token when one is missing", async () => {
      state.prisma.chat.findFirst.mockResolvedValueOnce({
        id: "chat-1",
        shareToken: null,
      });

      const response = await shareChat(
        new Request("http://localhost/api/chats/chat-1/share", {
          method: "POST",
        }),
        { params: Promise.resolve({ id: "chat-1" }) }
      );

      assert.equal(response.status, 200);
      assert.deepEqual(await jsonResponse(response), {
        data: {
          shareToken: "0102030405060708090a0b0c0d0e0f10",
          url: "http://localhost:3000/share/0102030405060708090a0b0c0d0e0f10",
        },
      });
      expect(state.prisma.chat.update).toHaveBeenCalledWith({
        where: { id: "chat-1" },
        data: { shareToken: "0102030405060708090a0b0c0d0e0f10" },
      });
    });
  });

  describe("POST /api/payments/stripe/webhook", () => {
    test("returns 400 when the signature header is missing", async () => {
      const response = await stripeWebhook(
        new Request("http://localhost/api/payments/stripe/webhook", {
          method: "POST",
          body: "payload",
        })
      );

      assert.equal(response.status, 400);
      assert.deepEqual(await jsonResponse(response), { error: "Missing signature" });
    });

    test("returns 500 when the webhook secret is missing", async () => {
      const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
      delete process.env.STRIPE_WEBHOOK_SECRET;

      const response = await stripeWebhook(
        new Request("http://localhost/api/payments/stripe/webhook", {
          method: "POST",
          headers: { "stripe-signature": "sig" },
          body: "payload",
        })
      );

      if (previousSecret) {
        process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
      }

      assert.equal(response.status, 500);
      assert.deepEqual(await jsonResponse(response), {
        error: "Webhook secret not set",
      });
    });

    test("maps invalid signatures to a 400 response", async () => {
      const stripe = state.getStripe();
      stripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error("bad signature");
      });

      const response = await stripeWebhook(
        new Request("http://localhost/api/payments/stripe/webhook", {
          method: "POST",
          headers: { "stripe-signature": "sig" },
          body: "payload",
        })
      );

      assert.equal(response.status, 400);
      assert.deepEqual(await jsonResponse(response), { error: "bad signature" });
    });

    test("records checkout completion and credits the user", async () => {
      const stripe = state.getStripe();
      stripe.webhooks.constructEvent.mockReturnValueOnce({
        id: "evt_1",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_1",
            metadata: { credits: "25", userId: "user-1" },
          },
        },
      });
      state.recordStripeWebhookEvent.mockResolvedValueOnce(true);
      state.prisma.$transaction.mockImplementationOnce(async (cb: any) =>
        cb({
          user: {
            findUnique: vi.fn().mockResolvedValue({ costCenterId: "cc-1" }),
            update: vi.fn().mockResolvedValue({}),
          },
          transaction: {
            create: vi.fn().mockResolvedValue({}),
          },
        })
      );

      const response = await stripeWebhook(
        new Request("http://localhost/api/payments/stripe/webhook", {
          method: "POST",
          headers: { "stripe-signature": "sig" },
          body: "payload",
        })
      );

      assert.equal(response.status, 200);
      assert.deepEqual(await jsonResponse(response), { received: true });
      expect(state.recordStripeWebhookEvent).toHaveBeenCalledWith({
        eventId: "evt_1",
        eventType: "checkout.session.completed",
        sessionId: "cs_1",
        client: expect.any(Object),
      });
    });
  });
});
