import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  transaction: vi.fn(),
  recordStripeWebhookEvent: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    webhooks: {
      constructEvent: state.constructEvent,
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
      })
    );
    state.recordStripeWebhookEvent.mockResolvedValue(true);
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
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
});
