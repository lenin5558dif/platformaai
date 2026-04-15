import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  checkRateLimit: vi.fn(),
  getStripe: vi.fn(),
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

import { POST } from "@/app/api/payments/stripe/checkout/route";

describe("POST /api/payments/stripe/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.USD_PER_CREDIT;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXTAUTH_URL;

    mocks.checkRateLimit.mockResolvedValue({
      ok: true,
      remaining: 4,
      resetAt: Date.now() + 60_000,
    });
  });

  test("returns 401 when unauthenticated", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/payments/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({ credits: 10 }),
      })
    );

    expect(response.status).toBe(401);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });

  test("returns 429 when rate limit is exceeded", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.checkRateLimit.mockResolvedValue({
      ok: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
    });

    const response = await POST(
      new Request("http://localhost/api/payments/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({ credits: 10 }),
      })
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Too many requests" });
  });

  test("returns 500 when Stripe is not configured", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getStripe.mockImplementation(() => {
      throw new Error("Stripe misconfigured");
    });

    const response = await POST(
      new Request("http://localhost/api/payments/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({ credits: 10 }),
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Stripe misconfigured" });
  });

  test("creates checkout session with env-derived URLs and rounded amount", async () => {
    process.env.USD_PER_CREDIT = "0.015";
    process.env.NEXTAUTH_URL = "https://auth.example.com";

    const create = vi.fn().mockResolvedValue({ url: "https://stripe.test/session" });
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getStripe.mockReturnValue({
      checkout: {
        sessions: {
          create,
        },
      },
    });

    const response = await POST(
      new Request("http://localhost/api/payments/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({ credits: 3 }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://stripe.test/session" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          userId: "user-1",
          credits: "3",
        },
        success_url: "https://auth.example.com/profile?success=1",
        cancel_url: "https://auth.example.com/profile?canceled=1",
      })
    );
    expect(create.mock.calls[0][0].line_items[0].price_data.unit_amount).toBe(5);
  });
});
