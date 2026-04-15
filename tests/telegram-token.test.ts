import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as bcrypt from "bcryptjs";

const state = vi.hoisted(() => ({
  authenticated: true,
  rateLimitOk: true,
  createdRecord: null as any,
  deletedRecords: [] as any[],
  userTelegramId: null as string | null,
  userEmail: "user@example.com",
  userOrgName: "Acme Org",
  tokenRecord: null as any,
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
    findFirst: vi.fn(async () => state.tokenRecord),
    create: vi.fn(async (data: any) => {
      state.createdRecord = {
        id: "token_1",
        ...data.data,
      };
      return state.createdRecord;
    }),
  },
  user: {
    findUnique: vi.fn(async () => ({
      email: state.userEmail,
      telegramId: state.userTelegramId,
      org: { name: state.userOrgName },
    })),
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
    state.userTelegramId = null;
    state.userEmail = "user@example.com";
    state.userOrgName = "Acme Org";
    state.tokenRecord = null;
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.TELEGRAM_LOGIN_BOT_NAME = "platformaai_bot";
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

  test("GET returns 401 if not authenticated", async () => {
    state.authenticated = false;
    const { GET } = await import("../src/app/api/telegram/token/route");
    const res = await GET(new Request("http://localhost/api/telegram/token"));

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

  test("returns 503 when telegram auth is not configured", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "REPLACE_ME";

    const { POST } = await import("../src/app/api/telegram/token/route");
    const res = await POST();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Telegram auth is not configured",
    });
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

  test("GET returns linked state when telegram is linked", async () => {
    state.userTelegramId = "123456";
    const { GET } = await import("../src/app/api/telegram/token/route");
    const req = new Request("http://localhost/api/telegram/token");

    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.state).toBe("linked");
    expect(json.telegramId).toBe("123456");
    expect(json.maskedEmail).toContain("***");
  });

  test("GET returns awaiting state when token is active", async () => {
    state.tokenRecord = {
      id: "token_1",
      usedAt: null,
      expiresAt: new Date("2025-01-01T00:10:00.000Z"),
    };
    const { GET } = await import("../src/app/api/telegram/token/route");
    const req = new Request(`http://localhost/api/telegram/token?token=${mockToken}`);

    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.state).toBe("awaiting_bot_confirmation");
  });

  test("GET returns expired error when token is expired", async () => {
    state.tokenRecord = {
      id: "token_1",
      usedAt: null,
      expiresAt: new Date("2024-12-31T23:59:00.000Z"),
    };
    const { GET } = await import("../src/app/api/telegram/token/route");
    const req = new Request(`http://localhost/api/telegram/token?token=${mockToken}`);

    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.state).toBe("error");
    expect(json.code).toBe("TOKEN_EXPIRED");
  });

  test("GET returns used/conflict code when token is used without linkage", async () => {
    state.tokenRecord = {
      id: "token_1",
      usedAt: new Date("2025-01-01T00:05:00.000Z"),
      expiresAt: new Date("2025-01-01T00:10:00.000Z"),
    };
    const { GET } = await import("../src/app/api/telegram/token/route");
    const req = new Request(`http://localhost/api/telegram/token?token=${mockToken}`);

    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.state).toBe("error");
    expect(json.code).toBe("TOKEN_USED_OR_CONFLICT");
  });

  test("GET without a token returns idle state and null profile hints", async () => {
    (state as any).userEmail = null;
    (state as any).userOrgName = null;
    state.userTelegramId = null;

    const { GET } = await import("../src/app/api/telegram/token/route");
    const req = new Request("http://localhost/api/telegram/token");

    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.state).toBe("idle");
    expect(json.telegramId).toBeNull();
    expect(json.maskedEmail).toBeNull();
    expect(json.orgName).toBeNull();
  });

  test("GET returns linked state when a missing token belongs to a linked account", async () => {
    state.userTelegramId = "123456";
    state.tokenRecord = null;

    const { GET } = await import("../src/app/api/telegram/token/route");
    const req = new Request(`http://localhost/api/telegram/token?token=${mockToken}`);

    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.state).toBe("linked");
    expect(json.code).toBeUndefined();
    expect(json.telegramId).toBe("123456");
  });

  test("GET returns linked state when a used token belongs to a linked account", async () => {
    state.userTelegramId = "123456";
    state.tokenRecord = {
      id: "token_1",
      usedAt: new Date("2025-01-01T00:05:00.000Z"),
      expiresAt: new Date("2025-01-01T00:10:00.000Z"),
    };

    const { GET } = await import("../src/app/api/telegram/token/route");
    const req = new Request(`http://localhost/api/telegram/token?token=${mockToken}`);

    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.state).toBe("linked");
    expect(json.code).toBeUndefined();
    expect(json.telegramId).toBe("123456");
  });

  test("POST returns null profile hints when user profile data is missing", async () => {
    (state as any).userEmail = null;
    (state as any).userOrgName = null;

    const { POST } = await import("../src/app/api/telegram/token/route");
    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.maskedEmail).toBeNull();
    expect(json.orgName).toBeNull();
  });
});
