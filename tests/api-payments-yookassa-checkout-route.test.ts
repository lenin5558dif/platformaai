import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticated: true,
  rateLimitOk: true,
  user: null as null | {
    email: string | null;
    emailVerifiedByProvider: boolean | null;
  },
  paymentUrl: "https://yookassa.test/confirm",
  paymentId: "pay_1",
}));

type CreateYookassaPaymentInput = {
  idempotenceKey: string;
  amountRub: number;
  description: string;
  returnUrl: string;
  metadata: Record<string, string>;
};

const createYookassaPayment = vi.fn(async (_params: CreateYookassaPaymentInput) => ({
  id: state.paymentId,
  confirmation: { confirmation_url: state.paymentUrl },
}));

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

vi.mock("@/lib/yookassa", () => ({
  createYookassaPayment,
  getYookassaReturnUrl: vi.fn(() => "http://app.test/settings"),
}));

describe("api payments yookassa checkout route", () => {
  beforeEach(() => {
    state.authenticated = true;
    state.rateLimitOk = true;
    state.user = {
      email: "user@example.com",
      emailVerifiedByProvider: true,
    };
    state.paymentUrl = "https://yookassa.test/confirm";
    state.paymentId = "pay_1";
    createYookassaPayment.mockClear();
    vi.clearAllMocks();
  });

  test("returns 401 when session is missing", async () => {
    state.authenticated = false;
    const { POST } = await import("../src/app/api/payments/yookassa/checkout/route");
    const res = await POST(
      new Request("http://localhost/api/payments/yookassa/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingTier: "tier_500" }),
      })
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(createYookassaPayment).not.toHaveBeenCalled();
  });

  test("returns 429 when rate limit is exceeded", async () => {
    state.rateLimitOk = false;
    const { POST } = await import("../src/app/api/payments/yookassa/checkout/route");
    const res = await POST(
      new Request("http://localhost/api/payments/yookassa/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingTier: "tier_500" }),
      })
    );

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many requests" });
    expect(createYookassaPayment).not.toHaveBeenCalled();
  });

  test("returns 403 when email is missing", async () => {
    state.user = {
      email: null,
      emailVerifiedByProvider: true,
    };

    const { POST } = await import("../src/app/api/payments/yookassa/checkout/route");
    const res = await POST(
      new Request("http://localhost/api/payments/yookassa/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingTier: "tier_500" }),
      })
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Добавьте email в настройках перед покупкой тарифа.",
    });
    expect(createYookassaPayment).not.toHaveBeenCalled();
  });

  test("returns 403 when email is not verified", async () => {
    state.user = {
      email: "user@example.com",
      emailVerifiedByProvider: false,
    };

    const { POST } = await import("../src/app/api/payments/yookassa/checkout/route");
    const res = await POST(
      new Request("http://localhost/api/payments/yookassa/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingTier: "tier_500" }),
      })
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Подтвердите email в настройках перед покупкой тарифа.",
    });
    expect(createYookassaPayment).not.toHaveBeenCalled();
  });

  test("rejects the free tier payload", async () => {
    const { POST } = await import("../src/app/api/payments/yookassa/checkout/route");

    await expect(
      POST(
        new Request("http://localhost/api/payments/yookassa/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ billingTier: "free" }),
        })
      )
    ).rejects.toThrow("Paid billing tier is required");
    expect(createYookassaPayment).not.toHaveBeenCalled();
  });

  test("creates payment for paid billing tiers", async () => {
    const { POST } = await import("../src/app/api/payments/yookassa/checkout/route");
    const res = await POST(
      new Request("http://localhost/api/payments/yookassa/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingTier: "tier_1500" }),
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: state.paymentUrl,
      paymentId: state.paymentId,
    });
    expect(createYookassaPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amountRub: 1500,
        description: "PlatformaAI • 1500 ₽",
        returnUrl: "http://app.test/settings",
        metadata: expect.objectContaining({
          userId: "user_1",
          credits: "1500",
          billingTier: "tier_1500",
          billingTierLabel: "1500 ₽",
          priceRub: "1500",
        }),
      })
    );
    const firstCall = createYookassaPayment.mock.calls[0];
    expect(firstCall).toBeDefined();
    const firstArgs = firstCall?.[0];
    expect(firstArgs).toBeDefined();
    expect(firstArgs!.idempotenceKey).toEqual(expect.any(String));
  });
});
