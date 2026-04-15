import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  checkRateLimit: vi.fn(),
  getStripe: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    billingPlan: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: mocks.getStripe,
}));

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

import { POST } from "@/app/api/payments/stripe/subscription/checkout/route";

describe("POST /api/payments/stripe/subscription/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXTAUTH_URL;
    delete process.env.STRIPE_PRICE_ID_CREATOR;
    delete process.env.STRIPE_PRICE_ID_PRO;
    mocks.checkRateLimit.mockResolvedValue({
      ok: true,
      remaining: 4,
      resetAt: Date.now() + 60_000,
    });
  });

  test("returns 401 when unauthenticated", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/payments/stripe/subscription/checkout", {
        method: "POST",
        body: JSON.stringify({ planId: "creator" }),
      })
    );

    expect(response.status).toBe(401);
  });

  test("returns 400 for non-purchasable plan", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });

    const response = await POST(
      new Request("http://localhost/api/payments/stripe/subscription/checkout", {
        method: "POST",
        body: JSON.stringify({ planId: "starter" }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Plan is not purchasable" });
  });

  test("returns 503 when stripe price is missing", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.prisma.user.findUnique.mockResolvedValue({
      email: "user@example.com",
      subscription: null,
    });
    mocks.prisma.billingPlan.findUnique.mockResolvedValue({
      code: "creator",
      stripePriceId: null,
      isActive: true,
    });

    const response = await POST(
      new Request("http://localhost/api/payments/stripe/subscription/checkout", {
        method: "POST",
        body: JSON.stringify({ planId: "creator" }),
      })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Stripe price is not configured for this plan",
    });
    expect(mocks.prisma.billingPlan.upsert).toHaveBeenCalledTimes(3);
  });

  test("creates subscription checkout session", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";

    const create = vi.fn().mockResolvedValue({ url: "https://stripe.test/subscription" });
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.prisma.user.findUnique.mockResolvedValue({
      email: "user@example.com",
      subscription: {
        stripeCustomerId: "cus_123",
      },
    });
    mocks.prisma.billingPlan.findUnique.mockResolvedValue({
      code: "creator",
      stripePriceId: "price_creator_123",
      isActive: true,
    });
    mocks.getStripe.mockReturnValue({
      checkout: {
        sessions: {
          create,
        },
      },
    });

    const response = await POST(
      new Request("http://localhost/api/payments/stripe/subscription/checkout", {
        method: "POST",
        body: JSON.stringify({ planId: "creator" }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://stripe.test/subscription" });
    expect(mocks.prisma.billingPlan.upsert).toHaveBeenCalledTimes(3);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer: "cus_123",
        success_url: "https://app.example.com/billing?subscription=success",
        cancel_url: "https://app.example.com/pricing?subscription=canceled",
        metadata: {
          userId: "user-1",
          planId: "creator",
        },
        subscription_data: {
          metadata: {
            userId: "user-1",
            planId: "creator",
          },
        },
      })
    );
  });

  test("bootstraps missing billing plans before resolving the requested plan", async () => {
    process.env.STRIPE_PRICE_ID_CREATOR = "price_creator_env";

    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.prisma.user.findUnique.mockResolvedValue({
      email: "user@example.com",
      subscription: null,
    });
    mocks.prisma.billingPlan.findUnique.mockResolvedValue({
      code: "creator",
      stripePriceId: null,
      isActive: true,
    });
    mocks.getStripe.mockReturnValue({
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({ url: "https://stripe.test/subscription" }),
        },
      },
    });

    const response = await POST(
      new Request("http://localhost/api/payments/stripe/subscription/checkout", {
        method: "POST",
        body: JSON.stringify({ planId: "creator" }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.prisma.billingPlan.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { code: "creator" },
        update: expect.objectContaining({
          stripePriceId: "price_creator_env",
          isActive: true,
        }),
      })
    );
  });
});
