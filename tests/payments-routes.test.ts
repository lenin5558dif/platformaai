import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stripeCheckout: vi.fn(),
  stripeSubscriptionCheckout: vi.fn(),
}));

vi.mock("@/app/api/payments/stripe/checkout/route", () => ({
  POST: mocks.stripeCheckout,
}));

vi.mock("@/app/api/payments/stripe/subscription/checkout/route", () => ({
  POST: mocks.stripeSubscriptionCheckout,
}));

describe("generic payment routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PAYMENTS_PROVIDER;
    delete process.env.YOOKASSA_CHECKOUT_ENABLED;
    delete process.env.YOOKASSA_SHOP_ID;
    delete process.env.YOOKASSA_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  test("delegates top-up checkout to legacy stripe route when stripe is configured", async () => {
    process.env.STRIPE_SECRET_KEY = "stripe-secret";
    process.env.STRIPE_WEBHOOK_SECRET = "stripe-webhook-secret";
    mocks.stripeCheckout.mockResolvedValue(
      new Response(JSON.stringify({ url: "https://legacy.test/checkout" }), { status: 200 })
    );

    const { POST } = await import("@/app/api/payments/checkout/route");
    const response = await POST(new Request("http://localhost/api/payments/checkout"));

    expect(mocks.stripeCheckout).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });

  test("falls back to stripe when yookassa env exists but feature flag is disabled", async () => {
    process.env.YOOKASSA_SHOP_ID = "shop";
    process.env.YOOKASSA_SECRET_KEY = "secret";
    process.env.STRIPE_SECRET_KEY = "stripe-secret";
    process.env.STRIPE_WEBHOOK_SECRET = "stripe-webhook-secret";
    mocks.stripeCheckout.mockResolvedValue(
      new Response(JSON.stringify({ url: "https://legacy.test/checkout" }), { status: 200 })
    );

    const { POST } = await import("@/app/api/payments/checkout/route");
    const response = await POST(new Request("http://localhost/api/payments/checkout"));

    expect(mocks.stripeCheckout).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });

  test("returns controlled 503 when yookassa is explicitly selected but not implemented", async () => {
    process.env.YOOKASSA_SHOP_ID = "shop";
    process.env.YOOKASSA_SECRET_KEY = "secret";
    process.env.YOOKASSA_CHECKOUT_ENABLED = "1";

    const { POST } = await import("@/app/api/payments/checkout/route");
    const response = await POST(new Request("http://localhost/api/payments/checkout"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "YooKassa checkout is temporarily unavailable",
    });
  });

  test("delegates subscription checkout to legacy stripe route when stripe is configured", async () => {
    process.env.STRIPE_SECRET_KEY = "stripe-secret";
    process.env.STRIPE_WEBHOOK_SECRET = "stripe-webhook-secret";
    mocks.stripeSubscriptionCheckout.mockResolvedValue(
      new Response(JSON.stringify({ url: "https://legacy.test/subscription" }), { status: 200 })
    );

    const { POST } = await import("@/app/api/payments/subscription/checkout/route");
    const response = await POST(
      new Request("http://localhost/api/payments/subscription/checkout")
    );

    expect(mocks.stripeSubscriptionCheckout).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });

  test("returns controlled 503 for explicit yookassa subscription selection", async () => {
    process.env.PAYMENTS_PROVIDER = "yookassa";
    process.env.YOOKASSA_SHOP_ID = "shop";
    process.env.YOOKASSA_SECRET_KEY = "secret";

    const { POST } = await import("@/app/api/payments/subscription/checkout/route");
    const response = await POST(
      new Request("http://localhost/api/payments/subscription/checkout")
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "YooKassa subscriptions are temporarily unavailable",
    });
  });
});
