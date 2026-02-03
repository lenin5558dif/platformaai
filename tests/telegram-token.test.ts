import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as bcrypt from "bcryptjs";

const state = vi.hoisted(() => ({
  authenticated: true,
  rateLimitOk: true,
  createdRecord: null as any,
  deletedRecords: [] as any[],
}));

const session = {
  user: {
    id: "user_1",
    orgId: "org_1",
  },
} as any;

const prisma = {
  telegramLinkToken: {
    deleteMany: vi.fn(async () => ({ count: 0 })),
    create: vi.fn(async (data: any) => {
      state.createdRecord = {
        id: "token_1",
        ...data.data,
      };
      return state.createdRecord;
    }),
  },
} as any;

vi.mock("@/lib/db", () => ({ prisma }));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (state.authenticated ? session : null)),
  handlers: {},
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({
    ok: state.rateLimitOk,
    remaining: state.rateLimitOk ? 4 : 0,
    resetAt: Date.now() + 60000,
  })),
}));

const mockToken = "a".repeat(48);
vi.mock("@/lib/tokens", () => ({
  generateToken: vi.fn(() => mockToken),
}));

describe("telegram token route", () => {
  beforeEach(async () => {
    state.authenticated = true;
    state.rateLimitOk = true;
    state.createdRecord = null;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns 401 if not authenticated", async () => {
    state.authenticated = false;
    const { POST } = await import("../src/app/api/telegram/token/route");
    const res = await POST();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  test("returns 429 when rate limit exceeded", async () => {
    state.rateLimitOk = false;
    const { POST } = await import("../src/app/api/telegram/token/route");
    const res = await POST();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many requests" });
  });

  test("TTL is 10 minutes from current time", async () => {
    const { POST } = await import("../src/app/api/telegram/token/route");
    const res = await POST();
    const json = await res.json();

    const expectedExpiresAt = new Date("2025-01-01T00:10:00.000Z");
    const actualExpiresAt = new Date(json.expiresAt);

    // Allow minimal tolerance for JSON serialization (1 second)
    const diffMs = Math.abs(actualExpiresAt.getTime() - expectedExpiresAt.getTime());
    expect(diffMs).toBeLessThan(1000);
  });

  test("response returns full token", async () => {
    const { POST } = await import("../src/app/api/telegram/token/route");
    const res = await POST();
    const json = await res.json();

    expect(json.token).toBe(mockToken);
  });

  test("deepLink includes full token", async () => {
    const { POST } = await import("../src/app/api/telegram/token/route");
    const res = await POST();
    const json = await res.json();

    expect(json.deepLink).toContain(mockToken);
    expect(json.deepLink).toBe(`https://t.me/platformaai_bot?start=${mockToken}`);
  });

  test("DB stores only prefix in token field", async () => {
    await import("../src/app/api/telegram/token/route");
    const { POST } = await import("../src/app/api/telegram/token/route");
    await POST();

    expect(prisma.telegramLinkToken.create).toHaveBeenCalled();
    const createCall = (prisma.telegramLinkToken.create as any).mock.calls[0][0];
    const storedToken = createCall.data.token;

    // Should store only first 16 characters (prefix)
    expect(storedToken).toBe(mockToken.slice(0, 16));
    expect(storedToken.length).toBe(16);
    expect(storedToken).not.toBe(mockToken);
  });

  test("DB stores bcrypt hash in telegramLinkTokenHash field", async () => {
    const { POST } = await import("../src/app/api/telegram/token/route");
    await POST();

    expect(prisma.telegramLinkToken.create).toHaveBeenCalled();
    const createCall = (prisma.telegramLinkToken.create as any).mock.calls[0][0];
    const storedHash = createCall.data.telegramLinkTokenHash;

    // Should be a valid bcrypt hash
    expect(storedHash).toBeDefined();
    expect(typeof storedHash).toBe("string");
    expect(storedHash.length).toBeGreaterThan(0);
    // Bcrypt hashes start with $2a$, $2b$, or $2y$
    expect(storedHash).toMatch(/^\$2[aby]\$/);
  });

  test("stored hash matches the returned token (bcrypt compare true)", async () => {
    const { POST } = await import("../src/app/api/telegram/token/route");
    const res = await POST();
    const json = await res.json();

    const createCall = (prisma.telegramLinkToken.create as any).mock.calls[0][0];
    const storedHash = createCall.data.telegramLinkTokenHash;

    // The hash should validate against the full token returned to the user
    const isMatch = bcrypt.compareSync(json.token, storedHash);
    expect(isMatch).toBe(true);
  });

  test("deletes existing tokens for user before creating new one", async () => {
    const { POST } = await import("../src/app/api/telegram/token/route");
    await POST();

    expect(prisma.telegramLinkToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user_1" },
    });
    expect(prisma.telegramLinkToken.create).toHaveBeenCalled();
  });
});
