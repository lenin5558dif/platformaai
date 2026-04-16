import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticated: true,
  rateLimitOk: true,
  user: null as null | {
    email: string | null;
    emailVerifiedByProvider: boolean | null;
  },
  checkoutUrl: "https://stripe.test/checkout",
  getStripeThrows: false,
  getStripeThrowValue: new Error("STRIPE_SECRET_KEY is not set") as unknown,
}));

const checkoutCreate = vi.fn(async () => ({ url: state.checkoutUrl }));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (state.authenticated ? { user: { id: "user_1" } } : null)),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({
    ok: state.rateLimitOk,
  })),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => state.user),
    },
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(() => {
    if (state.getStripeThrows) {
      throw state.getStripeThrowValue;
    }

    return {
      checkout: {
        sessions: {
          create: checkoutCreate,
        },
      },
    };
  }),
}));

describe("api payments stripe checkout route", () => {
  beforeEach(() => {
    state.authenticated = true;
    state.rateLimitOk = true;
    state.user = {
      email: "user@example.com",
      emailVerifiedByProvider: true,
    };
    state.getStripeThrows = false;
    state.getStripeThrowValue = new Error("STRIPE_SECRET_KEY is not set");
    state.checkoutUrl = "https://stripe.test/checkout";
    checkoutCreate.mockClear();
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://app.test");
    vi.stubEnv("NEXTAUTH_URL", "http://auth.test");
  });

  test("returns 401 when session is missing", async () => {
    state.authenticated = false;
    const { POST } = await import("../src/app/api/payments/stripe/checkout/route");
    const res = await POST(
      new Request("http://localhost/api/payments/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingTier: "tier_500" }),
      })
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  test("returns 429 when rate limit is exceeded", async () => {
    state.rateLimitOk = false;
    const { POST } = await import("../src/app/api/payments/stripe/checkout/route");
    const res = await POST(
      new Request("http://localhost/api/payments/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingTier: "tier_500" }),
      })
    );

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many requests" });
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  test("returns 403 when email is missing", async () => {
    state.user = {
      email: null,
      emailVerifiedByProvider: true,
    };

    const { POST } = await import("../src/app/api/payments/stripe/checkout/route");
    const res = await POST(
      new Request("http://localhost/api/payments/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingTier: "tier_500" }),
      })
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Добавьте email в настройках перед покупкой тарифа.",
    });
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  test("returns 403 when email is not verified", async () => {
    state.user = {
      email: "user@example.com",
      emailVerifiedByProvider: false,
    };

    const { POST } = await import("../src/app/api/payments/stripe/checkout/route");
    const res = await POST(
      new Request("http://localhost/api/payments/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingTier: "tier_500" }),
      })
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Подтвердите email в настройках перед покупкой тарифа.",
    });
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  test("rejects the free tier payload", async () => {
    const { POST } = await import("../src/app/api/payments/stripe/checkout/route");

    await expect(
      POST(
        new Request("http://localhost/api/payments/stripe/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ billingTier: "free" }),
        })
      )
    ).rejects.toThrow("Paid billing tier is required");
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  test("returns 500 when Stripe is not configured", async () => {
    state.getStripeThrows = true;
    const { POST } = await import("../src/app/api/payments/stripe/checkout/route");
    const res = await POST(
      new Request("http://localhost/api/payments/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingTier: "tier_500" }),
      })
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "STRIPE_SECRET_KEY is not set" });
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  test("handles non-error Stripe setup failures with a fallback message", async () => {
    state.getStripeThrows = true;
    state.getStripeThrowValue = "boom";
    const { POST } = await import("../src/app/api/payments/stripe/checkout/route");
    const res = await POST(
      new Request("http://localhost/api/payments/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingTier: "tier_500" }),
      })
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Stripe not configured" });
  });

  test("creates checkout session for paid billing tiers", async () => {
    const { POST } = await import("../src/app/api/payments/stripe/checkout/route");
    const res = await POST(
      new Request("http://localhost/api/payments/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingTier: "tier_1500" }),
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: state.checkoutUrl });
    expect(checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: expect.arrayContaining([
          expect.objectContaining({
            quantity: 1,
            price_data: expect.objectContaining({
              currency: "rub",
              unit_amount: 150000,
              product_data: expect.objectContaining({
                name: "PlatformaAI • 1500 ₽",
                description: "1500 кредитов и доступ к платным моделям",
              }),
            }),
          }),
        ]),
        metadata: expect.objectContaining({
          userId: "user_1",
          credits: "1500",
          billingTier: "tier_1500",
          billingTierLabel: "1500 ₽",
          priceRub: "1500",
        }),
        success_url: "http://app.test/settings?success=1",
        cancel_url: "http://app.test/settings?canceled=1",
      })
    );
  });

  test("falls back to NEXTAUTH_URL when public app url is missing", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("NEXTAUTH_URL", "http://auth-only.test");

    const { POST } = await import("../src/app/api/payments/stripe/checkout/route");
    const res = await POST(
      new Request("http://localhost/api/payments/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingTier: "tier_5000" }),
      })
    );

    expect(res.status).toBe(200);
    expect(checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url: "http://auth-only.test/settings?success=1",
        cancel_url: "http://auth-only.test/settings?canceled=1",
      })
    );
  });
});
