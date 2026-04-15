import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(),
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  userChannelUpsert: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  getRateLimitHeaders: vi.fn(() => ({
    "x-ratelimit-limit": "10",
    "x-ratelimit-remaining": "0",
    "x-ratelimit-reset": "60",
  })),
  getRetryAfterHeader: vi.fn(() => ({
    "retry-after": "60",
  })),
}));

vi.mock("@/lib/request-ip", () => ({
  getClientIp: mocks.getClientIp,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
      create: mocks.userCreate,
    },
    userChannel: {
      upsert: mocks.userChannelUpsert,
    },
  },
}));

import { POST } from "@/app/api/auth/register/route";

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClientIp.mockReturnValue("203.0.113.1");
    mocks.checkRateLimit.mockResolvedValue({
      ok: true,
      remaining: 9,
      resetAt: Date.now() + 60_000,
    });
    mocks.userFindUnique.mockResolvedValue(null);
    mocks.userCreate.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
    });
    mocks.userChannelUpsert.mockResolvedValue({
      userId: "user-1",
      channel: "WEB",
      externalId: "user-1",
    });
  });

  test("creates a brand new account for a new email", async () => {
    const response = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          nickname: "nikolay",
          email: "user@example.com",
          password: "strong-pass-123",
          confirmPassword: "strong-pass-123",
        }),
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.userCreate).toHaveBeenCalledTimes(1);
    expect(mocks.userChannelUpsert).toHaveBeenCalledTimes(1);
  });

  test("rejects registration when the email already exists even without a password hash", async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: "existing-user",
      passwordHash: null,
      settings: {},
    });

    const response = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          nickname: "nikolay",
          email: "user@example.com",
          password: "strong-pass-123",
          confirmPassword: "strong-pass-123",
        }),
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "EMAIL_ALREADY_EXISTS",
      message: "User with this email already exists.",
    });
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.userChannelUpsert).not.toHaveBeenCalled();
  });
});
