import { beforeEach, describe, expect, test, vi } from "vitest";

const { mockConstructEvent, mockTransaction, mockRecordStripeWebhookEvent } = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockTransaction: vi.fn(),
  mockRecordStripeWebhookEvent: vi.fn(),
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

describe("stripe webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
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
});
