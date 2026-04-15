import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  rateLimitOk: true,
  createdPayload: null as any,
  status: { state: "pending", expiresAt: new Date("2026-04-15T12:10:00.000Z") } as any,
}));

const prisma = {
  verificationToken: {
    create: vi.fn(async (args: any) => {
      state.createdPayload = args.data;
      return args.data;
    }),
    findUnique: vi.fn(async () => ({
      identifier: "telegram-login:pending",
      expires: new Date("2026-04-15T12:10:00.000Z"),
    })),
  },
  user: {
    findUnique: vi.fn(),
  },
} as any;

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/tokens", () => ({
  generateToken: vi.fn(() => "abc123token"),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ ok: state.rateLimitOk })),
}));
vi.mock("@/lib/telegram-login", async () => {
  const actual = await vi.importActual<typeof import("@/lib/telegram-login")>("@/lib/telegram-login");
  return {
    ...actual,
    readTelegramLoginStatus: vi.fn(async () => state.status),
  };
});

describe("telegram login token route", () => {
  beforeEach(() => {
    state.rateLimitOk = true;
    state.createdPayload = null;
    state.status = {
      state: "pending",
      expiresAt: new Date("2026-04-15T12:10:00.000Z"),
    };
    vi.stubEnv("TELEGRAM_LOGIN_BOT_NAME", "dontnikolaybot");
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test("creates a login token and returns both deep links", async () => {
    const { POST } = await import("../src/app/api/auth/telegram/login-token/route");
    const response = await POST(
      new Request("http://localhost/api/auth/telegram/login-token", {
        method: "POST",
        headers: {
          "x-forwarded-for": "127.0.0.1",
        },
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.deepLink).toBe("https://t.me/dontnikolaybot?start=login_abc123token");
    expect(json.appDeepLink).toBe("tg://resolve?domain=dontnikolaybot&start=login_abc123token");
    expect(state.createdPayload.identifier).toBe("telegram-login:pending");
  });

  test("rejects login token creation when feature is disabled", async () => {
    vi.stubEnv("TELEGRAM_LOGIN_BOT_NAME", "");

    const { POST } = await import("../src/app/api/auth/telegram/login-token/route");
    const response = await POST(
      new Request("http://localhost/api/auth/telegram/login-token", {
        method: "POST",
      })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "TELEGRAM_LOGIN_DISABLED",
    });
  });

  test("returns 429 on rate limit exhaustion", async () => {
    state.rateLimitOk = false;

    const { POST } = await import("../src/app/api/auth/telegram/login-token/route");
    const response = await POST(
      new Request("http://localhost/api/auth/telegram/login-token", {
        method: "POST",
        headers: {
          "x-forwarded-for": "127.0.0.1",
        },
      })
    );

    expect(response.status).toBe(429);
  });

  test("returns current poll state for a token", async () => {
    state.status = { state: "ready", userId: "user_1", expiresAt: new Date("2026-04-15T12:10:00.000Z") };

    const { GET } = await import("../src/app/api/auth/telegram/login-token/route");
    const response = await GET(
      new Request("http://localhost/api/auth/telegram/login-token?token=abc123token")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      state: "ready",
      userId: "user_1",
    });
  });
});
