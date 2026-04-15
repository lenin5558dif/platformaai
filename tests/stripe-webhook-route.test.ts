import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  retrieveSubscription: vi.fn(),
  transaction: vi.fn(),
  recordStripeWebhookEvent: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    webhooks: {
      constructEvent: state.constructEvent,
    },
    subscriptions: {
      retrieve: state.retrieveSubscription,
    },
  }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: state.transaction,
  },
}));

vi.mock("@/lib/stripe-webhook", () => ({
  recordStripeWebhookEvent: state.recordStripeWebhookEvent,
}));

describe("stripe webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.transaction.mockImplementation(async (fn: any) =>
      fn({
        user: {
          findUnique: vi.fn(),
          update: vi.fn(),
        },
        transaction: {
          create: vi.fn(),
        },
        billingPlan: {
          findUnique: vi.fn(),
          findMany: vi.fn(),
        },
        userSubscription: {
          findUnique: vi.fn(),
          upsert: vi.fn(),
          updateMany: vi.fn(),
        },
      })
    );
    state.recordStripeWebhookEvent.mockResolvedValue(true);
    state.retrieveSubscription.mockReset();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    delete process.env.STRIPE_PRICE_ID_CREATOR;
    delete process.env.STRIPE_PRICE_ID_PRO;
  });

  test("covers signature, secret, and checkout event branches", async () => {
    const { POST } = await import("@/app/api/payments/stripe/webhook/route");

    const missingSignature = await POST(new Request("http://localhost/api/payments/stripe/webhook"));
    expect(missingSignature.status).toBe(400);

    delete process.env.STRIPE_WEBHOOK_SECRET;
    const missingSecret = await POST(
      new Request("http://localhost/api/payments/stripe/webhook", {
        headers: { "stripe-signature": "sig" },
      })
    );
    expect(missingSecret.status).toBe(500);
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

    state.constructEvent.mockImplementationOnce(() => {
      throw new Error("bad signature");
    });
    const badSignature = await POST(
      new Request("http://localhost/api/payments/stripe/webhook", {
        headers: { "stripe-signature": "sig" },
      })
    );
    expect(badSignature.status).toBe(400);

    state.constructEvent.mockReturnValueOnce({
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          metadata: {
            credits: "5",
            userId: "user_1",
          },
        },
      },
    });
    const ok = await POST(
      new Request("http://localhost/api/payments/stripe/webhook", {
        headers: { "stripe-signature": "sig" },
      })
    );
    expect(ok.status).toBe(200);
    expect(state.recordStripeWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt_1",
        eventType: "checkout.session.completed",
        sessionId: "cs_1",
      })
    );
  });

  test("matches fallback subscription plan by exact env price id on invoice paid", async () => {
    process.env.STRIPE_PRICE_ID_PRO = "price_pro";

    const txState = {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      transaction: {
        create: vi.fn(),
      },
      billingPlan: {
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "plan_creator",
            code: "creator",
            stripePriceId: null,
            includedCreditsPerMonth: 100,
          },
          {
            id: "plan_pro",
            code: "pro",
            stripePriceId: null,
            includedCreditsPerMonth: 300,
          },
        ]),
      },
      userSubscription: {
        findUnique: vi.fn().mockResolvedValue({
          userId: "user_1",
          plan: { code: "pro" },
        }),
        upsert: vi.fn(),
        updateMany: vi.fn(),
      },
    };

    state.transaction.mockImplementationOnce(async (fn: any) => fn(txState));
    state.constructEvent.mockReturnValueOnce({
      id: "evt_invoice",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_1",
          amount_paid: 9900,
          subscription: "sub_1",
          lines: {
            data: [
              {
                price: {
                  id: "price_pro",
                },
              },
            ],
          },
        },
      },
    });
    state.retrieveSubscription.mockResolvedValue({
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      current_period_start: 1_712_000_000,
      current_period_end: 1_714_592_000,
      cancel_at_period_end: false,
      metadata: {},
      items: {
        data: [
          {
            price: {
              id: "price_pro",
            },
          },
        ],
      },
    });

    const { POST } = await import("@/app/api/payments/stripe/webhook/route");
    const response = await POST(
      new Request("http://localhost/api/payments/stripe/webhook", {
        headers: { "stripe-signature": "sig" },
      })
    );

    expect(response.status).toBe(200);
    expect(txState.userSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_1" },
        update: expect.objectContaining({
          planId: "plan_pro",
          includedCredits: 300,
        }),
      })
    );
    expect(txState.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "SUBSCRIPTION_RENEWAL",
          amount: 99,
        }),
      })
    );
  });
});
