import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticated: true,
  user: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (state.authenticated ? { user: { id: "user_1" } } : null)),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => state.user),
    },
  },
}));

describe("api me route", () => {
  beforeEach(() => {
    state.authenticated = true;
    state.user = {
      id: "user_1",
      email: "user@example.com",
      role: "ADMIN",
      balance: 42,
      emailVerifiedByProvider: true,
      settings: {
        billingTier: "tier_1500",
      },
      channelBindings: [
        {
          channel: "WEB",
          createdAt: new Date("2026-04-16T10:00:00.000Z"),
        },
        {
          channel: "TELEGRAM",
          createdAt: new Date("2026-04-16T11:00:00.000Z"),
        },
      ],
    };
    vi.clearAllMocks();
  });

  test("returns 401 when the session is missing", async () => {
    state.authenticated = false;
    const { GET } = await import("../src/app/api/me/route");
    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  test("returns 404 when the user is not found", async () => {
    state.user = null;
    const { GET } = await import("../src/app/api/me/route");
    const res = await GET();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  test("returns user data with billing tier and channels", async () => {
    const { GET } = await import("../src/app/api/me/route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      data: {
        id: "user_1",
        email: "user@example.com",
        role: "ADMIN",
        balance: "42",
        billingTier: "tier_1500",
        billingTierLabel: "1500 ₽",
        channels: [
          {
            channel: "WEB",
            linkedAt: "2026-04-16T10:00:00.000Z",
          },
          {
            channel: "TELEGRAM",
            linkedAt: "2026-04-16T11:00:00.000Z",
          },
        ],
      },
    });
  });
});
