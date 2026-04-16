import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  mockTransaction,
  mockRecordYookassaWebhookEvent,
  mockMergeSettings,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockRecordYookassaWebhookEvent: vi.fn(),
  mockMergeSettings: vi.fn((settings: unknown, patch: unknown) => ({
    settings,
    patch,
  })),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: mockTransaction,
  },
}));

vi.mock("@/lib/yookassa-webhook", () => ({
  recordYookassaWebhookEvent: mockRecordYookassaWebhookEvent,
  parseYookassaSucceededNotification: vi.fn((payload: unknown) => {
    const event = (payload as { event?: string })?.event;
    if (event !== "payment.succeeded") {
      throw new Error("Unsupported YooKassa webhook event");
    }
    return payload as any;
  }),
  getYookassaWebhookEventId: vi.fn(
    (notification: { event: string; object: { id?: string } }) =>
      `${notification.event}:${notification.object.id ?? "unknown"}`
  ),
}));

vi.mock("@/lib/user-settings", () => ({
  mergeSettings: mockMergeSettings,
}));

describe("yookassa webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("YOOKASSA_WEBHOOK_SECRET", "secret-test");
  });

  test("returns 500 when webhook secret is missing", async () => {
    vi.stubEnv("YOOKASSA_WEBHOOK_SECRET", "");
    const { POST } = await import("../src/app/api/payments/yookassa/webhook/[secret]/route");
    const res = await POST(
      new Request("http://localhost/api/payments/yookassa/webhook/secret-test", {
        method: "POST",
        body: "{}",
      }),
      { params: Promise.resolve({ secret: "secret-test" }) }
    );

    expect(res.status).toBe(500);
  });

  test("returns 404 when secret does not match", async () => {
    const { POST } = await import("../src/app/api/payments/yookassa/webhook/[secret]/route");
    const res = await POST(
      new Request("http://localhost/api/payments/yookassa/webhook/wrong", {
        method: "POST",
        body: "{}",
      }),
      { params: Promise.resolve({ secret: "wrong" }) }
    );

    expect(res.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test("returns 400 for invalid JSON", async () => {
    const { POST } = await import("../src/app/api/payments/yookassa/webhook/[secret]/route");
    const res = await POST(
      new Request("http://localhost/api/payments/yookassa/webhook/secret-test", {
        method: "POST",
        body: "not-json",
      }),
      { params: Promise.resolve({ secret: "secret-test" }) }
    );

    expect(res.status).toBe(400);
  });

  test("ignores unsupported event types", async () => {
    const { POST } = await import("../src/app/api/payments/yookassa/webhook/[secret]/route");
    const res = await POST(
      new Request("http://localhost/api/payments/yookassa/webhook/secret-test", {
        method: "POST",
        body: JSON.stringify({ event: "payment.canceled", object: {} }),
      }),
      { params: Promise.resolve({ secret: "secret-test" }) }
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test("returns 500 for malformed metadata", async () => {
    const { POST } = await import("../src/app/api/payments/yookassa/webhook/[secret]/route");
    const res = await POST(
      new Request("http://localhost/api/payments/yookassa/webhook/secret-test", {
        method: "POST",
        body: JSON.stringify({
          event: "payment.succeeded",
          object: { id: "pay_1", metadata: { credits: "0" } },
        }),
      }),
      { params: Promise.resolve({ secret: "secret-test" }) }
    );

    expect(res.status).toBe(500);
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockRecordYookassaWebhookEvent).not.toHaveBeenCalled();
  });

  test("ignores duplicate webhook events", async () => {
    mockRecordYookassaWebhookEvent.mockResolvedValue(false);
    mockTransaction.mockImplementation(async (fn: any) =>
      fn({
        user: { findUnique: vi.fn() },
        transaction: { create: vi.fn() },
      })
    );

    const { POST } = await import("../src/app/api/payments/yookassa/webhook/[secret]/route");
    const res = await POST(
      new Request("http://localhost/api/payments/yookassa/webhook/secret-test", {
        method: "POST",
        body: JSON.stringify({
          event: "payment.succeeded",
          object: {
            id: "pay_1",
            metadata: {
              userId: "user_1",
              credits: "500",
            },
          },
        }),
      }),
      { params: Promise.resolve({ secret: "secret-test" }) }
    );

    expect(res.status).toBe(200);
    expect(mockRecordYookassaWebhookEvent).toHaveBeenCalled();
  });

  test("records refill and updates user balance and plan", async () => {
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          costCenterId: "cc_1",
          settings: { billingTier: "free" },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      transaction: {
        create: vi.fn().mockResolvedValue({}),
      },
    };

    mockRecordYookassaWebhookEvent.mockResolvedValue(true);
    mockTransaction.mockImplementation(async (fn: any) => fn(tx));

    const { POST } = await import("../src/app/api/payments/yookassa/webhook/[secret]/route");
    const res = await POST(
      new Request("http://localhost/api/payments/yookassa/webhook/secret-test", {
        method: "POST",
        body: JSON.stringify({
          event: "payment.succeeded",
          object: {
            id: "pay_2",
            metadata: {
              userId: "user_1",
              credits: "1500",
              billingTier: "tier_1500",
              billingTierLabel: "1500 ₽",
            },
          },
        }),
      }),
      { params: Promise.resolve({ secret: "secret-test" }) }
    );

    expect(res.status).toBe(200);
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user_1" },
      select: { costCenterId: true, settings: true },
    });
    expect(mockMergeSettings).toHaveBeenCalledWith(
      { billingTier: "free" },
      {
        billingTier: "tier_1500",
        planName: "1500 ₽",
      }
    );
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: {
        balance: { increment: 1500 },
        settings: expect.any(Object),
      },
    });
    expect(tx.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user_1",
        amount: 1500,
        type: "REFILL",
        description: "ЮKassa пополнение • 1500 ₽",
        externalId: "pay_2",
      }),
    });
  });

  test("fails when webhook references an unknown user", async () => {
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      transaction: {
        create: vi.fn(),
      },
    };

    mockRecordYookassaWebhookEvent.mockResolvedValue(true);
    mockTransaction.mockImplementation(async (fn: any) => fn(tx));

    const { POST } = await import("../src/app/api/payments/yookassa/webhook/[secret]/route");

    await expect(
      POST(
        new Request("http://localhost/api/payments/yookassa/webhook/secret-test", {
          method: "POST",
          body: JSON.stringify({
            event: "payment.succeeded",
            object: {
              id: "pay_unknown",
              metadata: {
                userId: "missing_user",
                credits: "500",
                billingTierLabel: "500 ₽",
              },
            },
          }),
        }),
        { params: Promise.resolve({ secret: "secret-test" }) }
      )
    ).rejects.toThrow("YooKassa webhook references unknown user");
  });
});
