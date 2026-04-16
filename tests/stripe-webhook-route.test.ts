import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  mockConstructEvent,
  mockTransaction,
  mockRecordStripeWebhookEvent,
  mockMergeSettings,
} = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockTransaction: vi.fn(),
  mockRecordStripeWebhookEvent: vi.fn(),
  mockMergeSettings: vi.fn((settings: unknown, patch: unknown) => ({
    settings,
    patch,
  })),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(() => ({
    webhooks: {
      constructEvent: mockConstructEvent,
    },
  })),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: mockTransaction,
  },
}));

vi.mock("@/lib/stripe-webhook", () => ({
  recordStripeWebhookEvent: mockRecordStripeWebhookEvent,
}));

vi.mock("@/lib/user-settings", () => ({
  mergeSettings: mockMergeSettings,
}));

describe("stripe webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
  });

  test("returns 400 when signature is missing", async () => {
    const { POST } = await import("../src/app/api/payments/stripe/webhook/route");
    const res = await POST(
      new Request("http://localhost/api/payments/stripe/webhook", {
        method: "POST",
        body: "{}",
      })
    );

    expect(res.status).toBe(400);
  });

  test("returns 500 when webhook secret is missing", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");

    const { POST } = await import("../src/app/api/payments/stripe/webhook/route");
    const res = await POST(
      new Request("http://localhost/api/payments/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig" },
        body: "{}",
      })
    );

    expect(res.status).toBe(500);
  });

  test("returns 400 when signature is invalid", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("Invalid signature");
    });

    const { POST } = await import("../src/app/api/payments/stripe/webhook/route");
    const res = await POST(
      new Request("http://localhost/api/payments/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig" },
        body: "{}",
      })
    );

    expect(res.status).toBe(400);
  });

  test("handles non-error signature failures", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw "bad signature";
    });

    const { POST } = await import("../src/app/api/payments/stripe/webhook/route");
    const res = await POST(
      new Request("http://localhost/api/payments/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig" },
        body: "{}",
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid signature" });
  });

  test("returns 500 for malformed checkout metadata", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          metadata: {
            credits: "0",
          },
        },
      },
    });

    const { POST } = await import("../src/app/api/payments/stripe/webhook/route");
    const res = await POST(
      new Request("http://localhost/api/payments/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig" },
        body: "{}",
      })
    );

    expect(res.status).toBe(500);
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockRecordStripeWebhookEvent).not.toHaveBeenCalled();
  });

  test("ignores duplicate webhook events", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_dup",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_dup",
          metadata: {
            userId: "user_1",
            credits: "500",
          },
        },
      },
    });
    mockTransaction.mockImplementation(async (fn: any) =>
      fn({
        user: { findUnique: vi.fn() },
        transaction: { create: vi.fn() },
      })
    );
    mockRecordStripeWebhookEvent.mockResolvedValue(false);

    const { POST } = await import("../src/app/api/payments/stripe/webhook/route");
    const res = await POST(
      new Request("http://localhost/api/payments/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig" },
        body: "{}",
      })
    );

    expect(res.status).toBe(200);
    expect(mockRecordStripeWebhookEvent).toHaveBeenCalled();
  });

  test("ignores unrelated event types", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_other",
      type: "payment_intent.succeeded",
      data: {
        object: {},
      },
    });

    const { POST } = await import("../src/app/api/payments/stripe/webhook/route");
    const res = await POST(
      new Request("http://localhost/api/payments/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig" },
        body: "{}",
      })
    );

    expect(res.status).toBe(200);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test("records refill without plan metadata", async () => {
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          costCenterId: null,
          settings: { billingTier: "free" },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      transaction: {
        create: vi.fn().mockResolvedValue({}),
      },
    };

    mockConstructEvent.mockReturnValue({
      id: "evt_plain",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_plain",
          metadata: {
            userId: "user_1",
            credits: "500",
            billingTier: "tier_500",
          },
        },
      },
    });
    mockRecordStripeWebhookEvent.mockResolvedValue(true);
    mockTransaction.mockImplementation(async (fn: any) => fn(tx));

    const { POST } = await import("../src/app/api/payments/stripe/webhook/route");
    const res = await POST(
      new Request("http://localhost/api/payments/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig" },
        body: "{}",
      })
    );

    expect(res.status).toBe(200);
    expect(mockMergeSettings).not.toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: {
        balance: { increment: 500 },
        settings: undefined,
      },
    });
    expect(tx.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        description: "Stripe пополнение",
        costCenterId: undefined,
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

    mockConstructEvent.mockReturnValue({
      id: "evt_unknown",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_unknown",
          metadata: {
            userId: "missing_user",
            credits: "500",
            billingTierLabel: "500 ₽",
          },
        },
      },
    });
    mockRecordStripeWebhookEvent.mockResolvedValue(true);
    mockTransaction.mockImplementation(async (fn: any) => fn(tx));

    const { POST } = await import("../src/app/api/payments/stripe/webhook/route");

    await expect(
      POST(
        new Request("http://localhost/api/payments/stripe/webhook", {
          method: "POST",
          headers: { "stripe-signature": "sig" },
          body: "{}",
        })
      )
    ).rejects.toThrow("Stripe webhook references unknown user");
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

    mockConstructEvent.mockReturnValue({
      id: "evt_ok",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_ok",
          metadata: {
            userId: "user_1",
            credits: "1500",
            billingTier: "tier_1500",
            billingTierLabel: "1500 ₽",
          },
        },
      },
    });
    mockRecordStripeWebhookEvent.mockResolvedValue(true);
    mockTransaction.mockImplementation(async (fn: any) => fn(tx));

    const { POST } = await import("../src/app/api/payments/stripe/webhook/route");
    const res = await POST(
      new Request("http://localhost/api/payments/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig" },
        body: "{}",
      })
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
    expect(tx.user.update).toHaveBeenCalled();
    expect(tx.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user_1",
        amount: 1500,
        type: "REFILL",
        description: "Stripe пополнение • 1500 ₽",
      }),
    });
  });
});
