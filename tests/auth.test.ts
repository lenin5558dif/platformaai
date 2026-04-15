import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { hashSync } from "bcryptjs";
import { EmailSignInError } from "@auth/core/errors";
import { AuditAction } from "@prisma/client";
import { logAudit } from "@/lib/audit";

const state = vi.hoisted(() => ({
  nextAuthConfig: null as any,
  nextAuthAuth: vi.fn(),
  signInExport: vi.fn(),
  signOutExport: vi.fn(),
  sendMagicLink: vi.fn(),
  verifyTelegramLogin: vi.fn(),
  checkRateLimit: vi.fn(async () => ({
    ok: true,
    remaining: 4,
    resetAt: Date.now() + 900000,
  })),
  prisma: {
    user: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    orgDomain: {
      findUnique: vi.fn(),
    },
    userChannel: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({
  default: vi.fn((config: any) => {
    state.nextAuthConfig = config;
    return {
      handlers: { GET: "GET", POST: "POST" },
      signIn: state.signInExport,
      signOut: state.signOutExport,
      auth: state.nextAuthAuth,
    };
  }),
}));

vi.mock("next-auth/providers/credentials", () => ({
  default: vi.fn((config: any) => config),
}));

vi.mock("@auth/prisma-adapter", () => ({
  PrismaAdapter: vi.fn(() => "adapter"),
}));

vi.mock("@/lib/db", () => ({
  prisma: state.prisma,
}));

vi.mock("@/lib/unisender", () => ({
  sendMagicLink: state.sendMagicLink,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: state.checkRateLimit,
  getClientIp: vi.fn(() => "203.0.113.10"),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(() => ({
    get: (name: string) => (name === "x-forwarded-for" ? "203.0.113.10" : null),
  })),
}));

vi.mock("@/lib/telegram", () => ({
  verifyTelegramLogin: state.verifyTelegramLogin,
}));

const ORIGINAL_ENV = { ...process.env };

async function loadAuthModule() {
  vi.resetModules();
  state.nextAuthConfig = null;
  return import("../src/lib/auth");
}

function getProvider(id: string) {
  return state.nextAuthConfig.providers.find((provider: { id?: string }) => provider.id === id);
}

describe("auth module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.nextAuthAuth.mockReset();
    state.signInExport.mockReset();
    state.signOutExport.mockReset();
    state.sendMagicLink.mockReset();
    state.verifyTelegramLogin.mockReset();
    state.checkRateLimit.mockReset();
    state.checkRateLimit.mockImplementation(async () => ({
      ok: true,
      remaining: 4,
      resetAt: Date.now() + 900000,
    }));
    state.prisma.user.upsert.mockReset();
    state.prisma.user.findUnique.mockReset();
    state.prisma.user.update.mockReset();
    state.prisma.orgDomain.findUnique.mockReset();
    state.prisma.userChannel.upsert.mockReset();
    process.env = { ...ORIGINAL_ENV };
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/platformaai";
    process.env.AUTH_SECRET = "auth-secret";
    process.env.NEXTAUTH_URL = "https://app.example";
    process.env.APP_URL = "https://app.example";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example";
    process.env.OPENROUTER_API_KEY = "openrouter-key";
    process.env.UNISENDER_API_KEY = "unisender-key";
    process.env.UNISENDER_SENDER_EMAIL = "no-reply@example.com";
    process.env.YOOKASSA_SHOP_ID = "yookassa-shop";
    process.env.YOOKASSA_SECRET_KEY = "yookassa-secret";
    delete process.env.AUTH_BYPASS;
    delete process.env.AUTH_BYPASS_EMAIL;
    delete process.env.AUTH_BYPASS_ROLE;
    delete process.env.AUTH_BYPASS_BALANCE;
    delete process.env.AUTH_EMAIL_BLOCKLIST;
    delete process.env.AUTH_EMAIL_SUSPICIOUS_DOMAINS;
    delete process.env.SSO_ISSUER;
    delete process.env.SSO_CLIENT_ID;
    delete process.env.SSO_CLIENT_SECRET;
    delete process.env.SSO_NAME;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_LOGIN_BOT_NAME;
    delete process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test("email provider sends magic link through UniSender", async () => {
    await loadAuthModule();

    const signInCallback = state.nextAuthConfig.callbacks.signIn;
    await expect(
      signInCallback({
        user: { id: "u-1", email: "user@example.com" },
        account: { provider: "email", type: "email" },
        email: { verificationRequest: true },
        profile: null,
      }),
    ).resolves.toBe(true);

    const emailProvider = getProvider("email");
    await emailProvider.sendVerificationRequest({
      identifier: "user@example.com",
      url: "https://example.com/magic",
      token: "token",
      expires: new Date(),
      provider: {} as any,
      theme: undefined,
    } as any);

    expect(state.checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "auth:email:user@example.com",
        limit: 5,
        windowMs: 900000,
      }),
    );
    expect(state.checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "auth:email-ip:203.0.113.10",
        limit: 20,
        windowMs: 900000,
      }),
    );
    expect(state.checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "auth:email-domain:example.com",
        limit: 20,
        windowMs: 900000,
      }),
    );
    expect(state.sendMagicLink).toHaveBeenCalledWith({
      email: "user@example.com",
      url: "https://example.com/magic",
    });
  });

  test("email provider is not registered when sender configuration is incomplete", async () => {
    delete process.env.UNISENDER_SENDER_EMAIL;

    await loadAuthModule();

    expect(
      state.nextAuthConfig.providers.some((provider: { id?: string }) => provider.id === "email")
    ).toBe(false);
  });

  test("email provider blocks magic link sending when rate limited", async () => {
    await loadAuthModule();
    state.checkRateLimit.mockResolvedValueOnce({
      ok: false,
      remaining: 0,
      resetAt: Date.now() + 900000,
    });

    const signInCallback = state.nextAuthConfig.callbacks.signIn;

    await expect(
      signInCallback({
        user: { id: "u-1", email: "user@example.com" },
        account: { provider: "email", type: "email" },
        email: { verificationRequest: true },
        profile: null,
      }),
    ).rejects.toBeInstanceOf(EmailSignInError);

    expect(state.sendMagicLink).not.toHaveBeenCalled();
  });

  test("email provider blocks configured email domains and audits them", async () => {
    process.env.AUTH_EMAIL_BLOCKLIST = "blocked.example,blocked@tenant.example";
    await loadAuthModule();
    const emailProvider = getProvider("email");

    await expect(
      emailProvider.sendVerificationRequest({
        identifier: "Blocked@Tenant.Example",
        url: "https://example.com/magic",
        token: "token",
        expires: new Date(),
        provider: {} as any,
        theme: undefined,
      } as any),
    ).rejects.toBeInstanceOf(EmailSignInError);

    expect(state.sendMagicLink).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.POLICY_BLOCKED,
        metadata: expect.objectContaining({
          auth: expect.objectContaining({
            stage: "email_signin",
            reason: "blocked_email_domain",
            email: "blocked@tenant.example",
            domain: "tenant.example",
            blocked: true,
          }),
        }),
      }),
    );
  });

  test("email provider throttles suspicious domains with a distinct audit reason", async () => {
    process.env.AUTH_EMAIL_SUSPICIOUS_DOMAINS = "temp.example";
    await loadAuthModule();
    state.checkRateLimit.mockResolvedValueOnce({
      ok: false,
      remaining: 0,
      resetAt: Date.now() + 900000,
    });
    const emailProvider = getProvider("email");

    await expect(
      emailProvider.sendVerificationRequest({
        identifier: "user@temp.example",
        url: "https://example.com/magic",
        token: "token",
        expires: new Date(),
        provider: {} as any,
        theme: undefined,
      } as any),
    ).rejects.toBeInstanceOf(EmailSignInError);

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.POLICY_BLOCKED,
        metadata: expect.objectContaining({
          auth: expect.objectContaining({
            stage: "email_signin",
            reason: "suspicious_domain_throttled",
            email: "user@temp.example",
            domain: "temp.example",
            blocked: true,
            suspicious: true,
          }),
        }),
      }),
    );
  });

  test("email provider wraps transport failures as send errors", async () => {
    await loadAuthModule();
    state.sendMagicLink.mockRejectedValueOnce(new Error("boom"));
    const emailProvider = getProvider("email");

    await expect(
      emailProvider.sendVerificationRequest({
        identifier: "user@example.com",
        url: "https://example.com/magic",
        token: "token",
        expires: new Date(),
        provider: {} as any,
        theme: undefined,
      } as any),
    ).rejects.toBeInstanceOf(EmailSignInError);
  });

  test("adds SSO provider when issuer credentials are configured", async () => {
    process.env.SSO_ISSUER = "https://issuer.example";
    process.env.SSO_CLIENT_ID = "client-id";
    process.env.SSO_CLIENT_SECRET = "client-secret";
    process.env.SSO_NAME = "Corp SSO";

    await loadAuthModule();

    expect(state.nextAuthConfig.providers).toHaveLength(3);
    expect(getProvider("sso")).toMatchObject({
      id: "sso",
      name: "Corp SSO",
      issuer: "https://issuer.example",
      clientId: "client-id",
      clientSecret: "client-secret",
      allowDangerousEmailAccountLinking: true,
    });
  });

  test("credentials authorize accepts valid email and password", async () => {
    state.prisma.user.findUnique.mockResolvedValue({
      id: "u-credentials",
      email: "user@example.com",
      role: "USER",
      orgId: "org-1",
      balance: { toString: () => "7" },
      passwordHash: hashSync("correct-horse-battery-staple", 10),
      isActive: true,
      emailVerifiedByProvider: null,
    });

    await loadAuthModule();
    const credentialsProvider = getProvider("credentials");

    await expect(
      credentialsProvider.authorize({
        email: "user@example.com",
        password: "correct-horse-battery-staple",
      })
    ).resolves.toEqual({
      id: "u-credentials",
      email: "user@example.com",
      name: "user@example.com",
      role: "USER",
      orgId: "org-1",
      balance: "7",
      emailVerifiedByProvider: null,
    });
  });

  test("credentials authorize rejects invalid password or missing password hash", async () => {
    state.prisma.user.findUnique.mockResolvedValueOnce({
      id: "u-credentials",
      email: "user@example.com",
      role: "USER",
      orgId: null,
      balance: { toString: () => "0" },
      passwordHash: hashSync("correct-password", 10),
      isActive: true,
      emailVerifiedByProvider: null,
    });

    await loadAuthModule();
    const credentialsProvider = getProvider("credentials");

    await expect(
      credentialsProvider.authorize({
        email: "user@example.com",
        password: "wrong-password",
      })
    ).resolves.toBeNull();

    state.prisma.user.findUnique.mockResolvedValueOnce({
      id: "u-credentials-2",
      email: "user2@example.com",
      role: "USER",
      orgId: null,
      balance: { toString: () => "0" },
      passwordHash: null,
      isActive: true,
      emailVerifiedByProvider: null,
    });

    await expect(
      credentialsProvider.authorize({
        email: "user2@example.com",
        password: "correct-password",
      })
    ).resolves.toBeNull();
  });

  test("telegram authorize rejects empty, invalid, and unverifiable payloads", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_LOGIN_BOT_NAME = "platformaai_bot";
    process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME = "platformaai_bot";
    process.env.NEXT_PUBLIC_TELEGRAM_AUTH_ENABLED = "1";

    await loadAuthModule();
    const telegramProvider = getProvider("telegram");

    await expect(telegramProvider.authorize(undefined)).resolves.toBeNull();
    await expect(telegramProvider.authorize({ data: 123 })).resolves.toBeNull();
    await expect(telegramProvider.authorize({ data: "{bad json" })).resolves.toBeNull();

    state.verifyTelegramLogin.mockReturnValue(false);
    await expect(
      telegramProvider.authorize({
        data: JSON.stringify({ id: 1, auth_date: 123, hash: "hash" }),
      }),
    ).resolves.toBeNull();
  });

  test("telegram authorize upserts user and maps fallback profile fields", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_LOGIN_BOT_NAME = "platformaai_bot";
    process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME = "platformaai_bot";
    process.env.NEXT_PUBLIC_TELEGRAM_AUTH_ENABLED = "1";
    state.verifyTelegramLogin.mockReturnValue(true);
    state.prisma.user.findUnique.mockResolvedValue({
      id: "u-1",
      email: null,
      role: "USER",
      orgId: "org-1",
      balance: { toString: () => "12" },
    });

    await loadAuthModule();
    const telegramProvider = getProvider("telegram");

    const result = await telegramProvider.authorize({
      data: JSON.stringify({
        id: 42,
        username: "platforma_bot",
        auth_date: 123,
        hash: "hash",
      }),
    });

    expect(state.verifyTelegramLogin).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42 }),
      "bot-token",
    );
    expect(state.prisma.user.findUnique).toHaveBeenCalledWith({
      where: { telegramId: "42" },
      select: {
        id: true,
        email: true,
        role: true,
        orgId: true,
        balance: true,
      },
    });
    expect(result).toEqual({
      id: "u-1",
      email: undefined,
      name: "platforma_bot",
      image: undefined,
      role: "USER",
      orgId: "org-1",
      balance: "12",
    });
  });

  test("telegram authorize falls back to generic display name", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_LOGIN_BOT_NAME = "platformaai_bot";
    process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME = "platformaai_bot";
    process.env.NEXT_PUBLIC_TELEGRAM_AUTH_ENABLED = "1";
    state.verifyTelegramLogin.mockReturnValue(true);
    state.prisma.user.findUnique.mockResolvedValue({
      id: "u-2",
      email: "tg@example.com",
      role: "USER",
      orgId: null,
      balance: { toString: () => "5" },
    });

    await loadAuthModule();
    const telegramProvider = getProvider("telegram");

    const result = await telegramProvider.authorize({
      data: JSON.stringify({
        id: 77,
        auth_date: 123,
        hash: "hash",
      }),
    });

    expect(result?.name).toBe("Telegram User");
  });

  test("telegram provider is not registered when Telegram auth is disabled", async () => {
    await loadAuthModule();

    expect(getProvider("telegram")).toBeUndefined();
  });

  test("telegram authorize rejects accounts that are not linked yet", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_LOGIN_BOT_NAME = "platformaai_bot";
    process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME = "platformaai_bot";
    process.env.NEXT_PUBLIC_TELEGRAM_AUTH_ENABLED = "1";
    state.verifyTelegramLogin.mockReturnValue(true);
    state.prisma.user.findUnique.mockResolvedValue(null);

    await loadAuthModule();
    const telegramProvider = getProvider("telegram");

    await expect(
      telegramProvider.authorize({
        data: JSON.stringify({
          id: 404,
          auth_date: 123,
          hash: "hash",
        }),
      })
    ).resolves.toBeNull();
  });

  test("registers temp access provider and authorizes by token", async () => {
    process.env.TEMP_ACCESS_TOKEN = "smoke-token";
    process.env.NEXT_PUBLIC_TEMP_ACCESS_ENABLED = "1";
    process.env.TEMP_ACCESS_EMAIL = "smoke@example.com";
    process.env.TEMP_ACCESS_ROLE = "ADMIN";
    state.prisma.user.upsert.mockResolvedValue({
      id: "u-temp",
      email: "smoke@example.com",
      role: "ADMIN",
      orgId: null,
      balance: { toString: () => "100" },
    });

    await loadAuthModule();

    expect(
      state.nextAuthConfig.providers.some(
        (provider: { id?: string }) => provider.id === "temp-access"
      )
    ).toBe(true);

    const tempProvider = state.nextAuthConfig.providers.find(
      (provider: { id?: string }) => provider.id === "temp-access"
    );

    await expect(tempProvider.authorize({ token: "bad-token" })).resolves.toBeNull();

    await expect(
      tempProvider.authorize({ token: "smoke-token" })
    ).resolves.toEqual({
      id: "u-temp",
      email: "smoke@example.com",
      name: "Temporary Access",
      role: "ADMIN",
      orgId: null,
      balance: "100",
    });
  });

  test("signIn callback enforces inactive user and sso-only domain policy", async () => {
    await loadAuthModule();
    const signInCallback = state.nextAuthConfig.callbacks.signIn;

    state.prisma.user.findUnique.mockResolvedValueOnce({
      isActive: false,
      orgId: "org-a",
      role: "EMPLOYEE",
    });

    await expect(
      signInCallback({
        user: { id: "u-1", email: "user@example.com" },
        account: { provider: "email", type: "email" },
        profile: null,
      }),
    ).resolves.toBe("/login?error=AccountDisabled");

    state.prisma.user.findUnique.mockResolvedValueOnce({
      isActive: true,
      orgId: "org-a",
      role: "EMPLOYEE",
    });
    state.prisma.orgDomain.findUnique.mockResolvedValueOnce({
      orgId: "org-a",
      ssoOnly: true,
    });

    await expect(
      signInCallback({
        user: { id: "u-1", email: "user@example.com" },
        account: { provider: "email", type: "email" },
        profile: null,
      }),
    ).resolves.toBe("/login?error=SSORequired");
  });

  test("signIn callback allows users without a matching db row to continue", async () => {
    await loadAuthModule();
    const signInCallback = state.nextAuthConfig.callbacks.signIn;

    state.prisma.user.findUnique.mockReset();
    state.prisma.orgDomain.findUnique.mockReset();
    state.prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      signInCallback({
        user: { id: "u-1", email: "user@example.com" },
        account: { provider: "email", type: "email" },
        profile: null,
      }),
    ).resolves.toBe(true);
    expect(state.prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "u-1" },
      select: { isActive: true, orgId: true, role: true },
    });
  });

  test("signIn callback rebinds org on SSO and updates channel verification metadata", async () => {
    await loadAuthModule();
    const signInCallback = state.nextAuthConfig.callbacks.signIn;

    state.prisma.user.findUnique.mockResolvedValue({
      isActive: true,
      orgId: "org-a",
      role: "ADMIN",
    });
    state.prisma.orgDomain.findUnique.mockResolvedValue({
      orgId: "org-b",
      ssoOnly: false,
    });

    await expect(
      signInCallback({
        user: { id: "u-1", email: "admin@example.com" },
        account: { provider: "sso", type: "oauth" },
        profile: { email_verified: false },
      }),
    ).resolves.toBe(true);

    expect(state.prisma.user.update).toHaveBeenNthCalledWith(1, {
      where: { id: "u-1" },
      data: {
        orgId: "org-b",
        role: "ADMIN",
      },
    });
    expect(state.prisma.userChannel.upsert).toHaveBeenCalledWith({
      where: {
        userId_channel: {
          userId: "u-1",
          channel: "WEB",
        },
      },
      update: { externalId: "u-1" },
      create: {
        userId: "u-1",
        channel: "WEB",
        externalId: "u-1",
      },
    });
    expect(state.prisma.user.update).toHaveBeenNthCalledWith(2, {
      where: { id: "u-1" },
      data: { emailVerifiedByProvider: false },
    });
  });

  test("signIn callback skips channel bookkeeping for credentials and short-circuits missing identity", async () => {
    await loadAuthModule();
    const signInCallback = state.nextAuthConfig.callbacks.signIn;

    await expect(
      signInCallback({
        user: { id: "u-1" },
        account: { provider: "credentials", type: "credentials" },
        profile: null,
      }),
    ).resolves.toBe(true);

    await expect(
      signInCallback({
        user: { email: "user@example.com" },
        account: { provider: "credentials", type: "credentials" },
        profile: null,
      }),
    ).resolves.toBe(true);

    state.prisma.user.findUnique.mockResolvedValue({
      isActive: true,
      orgId: "org-a",
      role: "EMPLOYEE",
    });
    state.prisma.orgDomain.findUnique.mockResolvedValue({
      orgId: "org-a",
      ssoOnly: false,
    });

    await expect(
      signInCallback({
        user: { id: "u-1", email: "user@example.com" },
        account: { provider: "credentials", type: "credentials" },
        profile: null,
      }),
    ).resolves.toBe(true);

    expect(state.prisma.userChannel.upsert).not.toHaveBeenCalled();
  });

  test("signIn callback allows emails without a domain and session callback tolerates missing session.user", async () => {
    await loadAuthModule();
    const signInCallback = state.nextAuthConfig.callbacks.signIn;
    const sessionCallback = state.nextAuthConfig.callbacks.session;

    state.prisma.user.findUnique.mockResolvedValue({
      isActive: true,
      orgId: "org-a",
      role: "EMPLOYEE",
    });

    await expect(
      signInCallback({
        user: { id: "u-1", email: "invalid-email" },
        account: { provider: "email", type: "email" },
        profile: null,
      }),
    ).resolves.toBe(true);

    expect(state.prisma.orgDomain.findUnique).not.toHaveBeenCalled();

    const session = await sessionCallback({
      session: {},
      user: {
        id: "u-1",
        role: "ADMIN",
        orgId: "org-1",
        balance: 99,
        emailVerifiedByProvider: true,
      },
    });

    expect(session).toEqual({});
  });

  test("signIn callback marks email provider as verified without profile flag", async () => {
    await loadAuthModule();
    const signInCallback = state.nextAuthConfig.callbacks.signIn;

    state.prisma.user.findUnique.mockResolvedValue({
      isActive: true,
      orgId: "org-a",
      role: "EMPLOYEE",
    });
    state.prisma.orgDomain.findUnique.mockResolvedValue({
      orgId: "org-a",
      ssoOnly: false,
    });

    await expect(
      signInCallback({
        user: { id: "u-1", email: "user@example.com" },
        account: { provider: "email", type: "email" },
        profile: null,
      }),
    ).resolves.toBe(true);

    expect(state.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u-1" },
      data: { emailVerifiedByProvider: true },
    });
  });

  test("session callback copies db-backed user fields into the session", async () => {
    await loadAuthModule();
    const sessionCallback = state.nextAuthConfig.callbacks.session;

    const session = await sessionCallback({
      session: { user: {} },
      user: {
        id: "u-1",
        role: "ADMIN",
        orgId: "org-1",
        balance: 99,
        emailVerifiedByProvider: true,
      },
    });

    expect(session.user).toEqual({
      id: "u-1",
      role: "ADMIN",
      orgId: "org-1",
      balance: "99",
      emailVerifiedByProvider: true,
      sessionTokenIssuedAt: null,
    });
  });

  test("auth returns bypass session in non-production and hydrates live session from prisma", async () => {
    process.env.AUTH_BYPASS = "1";
    process.env.AUTH_BYPASS_EMAIL = "dev@example.com";
    process.env.AUTH_BYPASS_ROLE = "EMPLOYEE";
    process.env.AUTH_BYPASS_BALANCE = "77";
    state.prisma.user.upsert.mockResolvedValue({
      id: "bypass-user",
      email: "dev@example.com",
      role: "EMPLOYEE",
      orgId: "org-1",
      balance: { toString: () => "77" },
    });

    let mod = await loadAuthModule();
    await expect(mod.auth()).resolves.toMatchObject({
      user: {
        id: "bypass-user",
        email: "dev@example.com",
        role: "EMPLOYEE",
        orgId: "org-1",
        balance: "77",
        emailVerifiedByProvider: null,
      },
    });

    process.env.AUTH_BYPASS = "0";
    state.nextAuthAuth.mockResolvedValue({
      user: {
        id: "live-user",
        role: "USER",
        orgId: null,
        balance: "10",
      },
    });
    state.prisma.user.findUnique.mockResolvedValue({
      isActive: true,
      orgId: "org-2",
      role: "ADMIN",
      emailVerifiedByProvider: true,
    });

    mod = await loadAuthModule();
    const session = await mod.auth(new Request("http://localhost"));

    expect(state.nextAuthAuth).toHaveBeenCalled();
    expect(session?.user).toMatchObject({
      id: "live-user",
      role: "ADMIN",
      orgId: "org-2",
      emailVerifiedByProvider: true,
    });
  });

  test("telegram auth routes reject unauthorized, invalid, conflict, and success cases", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_LOGIN_BOT_NAME = "platformaai_bot";
    process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME = "platformaai_bot";
    process.env.NEXT_PUBLIC_TELEGRAM_AUTH_ENABLED = "1";

    state.nextAuthAuth.mockResolvedValueOnce(null);
    let mod = await import("../src/app/api/auth/link-telegram/route");
    let res = await mod.POST(
      new Request("http://localhost/api/auth/link-telegram", {
        method: "POST",
        body: JSON.stringify({
          id: 1,
          auth_date: 123,
          hash: "hash",
        }),
      }),
    );
    expect(res.status).toBe(401);

    state.nextAuthAuth.mockResolvedValue({
      user: { id: "u-1" },
    });
    state.prisma.user.findUnique.mockResolvedValue({
      isActive: true,
      orgId: "org-1",
      role: "USER",
      emailVerifiedByProvider: null,
    });
    state.checkRateLimit.mockResolvedValue({
      ok: true,
      remaining: 9,
      resetAt: Date.now() + 60000,
    });
    state.checkRateLimit.mockResolvedValueOnce({
      ok: false,
      remaining: 0,
      resetAt: Date.now() + 60000,
    });
    vi.resetModules();
    mod = await import("../src/app/api/auth/link-telegram/route");
    res = await mod.POST(
      new Request("http://localhost/api/auth/link-telegram", {
        method: "POST",
        headers: {
          "x-forwarded-for": "198.51.100.7",
        },
        body: JSON.stringify({
          id: 1,
          auth_date: 123,
          hash: "hash",
        }),
      }),
    );
    expect(res.status).toBe(429);

    state.verifyTelegramLogin.mockReturnValueOnce(false);
    vi.resetModules();
    mod = await import("../src/app/api/auth/link-telegram/route");
    res = await mod.POST(
      new Request("http://localhost/api/auth/link-telegram", {
        method: "POST",
        body: JSON.stringify({
          id: 2,
          auth_date: 123,
          hash: "hash",
        }),
      }),
    );
    expect(res.status).toBe(401);

    state.verifyTelegramLogin.mockReturnValueOnce(true);
    state.prisma.user.update.mockRejectedValueOnce(new Error("conflict"));
    vi.resetModules();
    mod = await import("../src/app/api/auth/link-telegram/route");
    res = await mod.POST(
      new Request("http://localhost/api/auth/link-telegram", {
        method: "POST",
        body: JSON.stringify({
          id: 3,
          auth_date: 123,
          hash: "hash",
        }),
      }),
    );
    expect(res.status).toBe(409);

    state.verifyTelegramLogin.mockReturnValueOnce(true);
    state.prisma.user.update.mockResolvedValueOnce({ id: "u-1" });
    vi.resetModules();
    mod = await import("../src/app/api/auth/link-telegram/route");
    res = await mod.POST(
      new Request("http://localhost/api/auth/link-telegram", {
        method: "POST",
        body: JSON.stringify({
          id: 4,
          auth_date: 123,
          hash: "hash",
        }),
      }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(state.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u-1" },
      data: { telegramId: "4" },
    });
  });

  test("telegram verify route enforces rate limit and validates payloads", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_LOGIN_BOT_NAME = "platformaai_bot";
    process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME = "platformaai_bot";
    process.env.NEXT_PUBLIC_TELEGRAM_AUTH_ENABLED = "1";

    state.checkRateLimit.mockResolvedValueOnce({
      ok: false,
      remaining: 0,
      resetAt: Date.now() + 60000,
    });
    let mod = await import("../src/app/api/auth/telegram/verify/route");
    let res = await mod.POST(
      new Request("http://localhost/api/auth/telegram/verify", {
        method: "POST",
        headers: {
          "x-real-ip": "203.0.113.8",
        },
        body: JSON.stringify({
          id: 1,
          auth_date: 123,
          hash: "hash",
        }),
      }),
    );
    expect(res.status).toBe(429);

    state.checkRateLimit.mockResolvedValueOnce({
      ok: true,
      remaining: 19,
      resetAt: Date.now() + 60000,
    });
    state.verifyTelegramLogin.mockReturnValueOnce(false);
    vi.resetModules();
    mod = await import("../src/app/api/auth/telegram/verify/route");
    res = await mod.POST(
      new Request("http://localhost/api/auth/telegram/verify", {
        method: "POST",
        body: JSON.stringify({
          id: 2,
          auth_date: 123,
          hash: "hash",
        }),
      }),
    );
    expect(res.status).toBe(401);

    state.verifyTelegramLogin.mockReturnValueOnce(true);
    state.prisma.user.findUnique.mockResolvedValueOnce(null);
    vi.resetModules();
    mod = await import("../src/app/api/auth/telegram/verify/route");
    res = await mod.POST(
      new Request("http://localhost/api/auth/telegram/verify", {
        method: "POST",
        body: JSON.stringify({
          id: 3,
          auth_date: 123,
          hash: "hash",
        }),
      }),
    );
    expect(res.status).toBe(404);

    state.verifyTelegramLogin.mockReturnValueOnce(true);
    state.prisma.user.findUnique.mockResolvedValueOnce({ id: "u-telegram" });
    vi.resetModules();
    mod = await import("../src/app/api/auth/telegram/verify/route");
    res = await mod.POST(
      new Request("http://localhost/api/auth/telegram/verify", {
        method: "POST",
        body: JSON.stringify({
          id: 4,
          auth_date: 123,
          hash: "hash",
        }),
      }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  test("auth returns null for missing, inactive, and absent live sessions", async () => {
    state.nextAuthAuth.mockResolvedValueOnce({ user: { id: "u-1" } });
    state.prisma.user.findUnique.mockResolvedValueOnce(null);

    let mod = await loadAuthModule();
    await expect(mod.auth()).resolves.toBeNull();

    state.nextAuthAuth.mockResolvedValueOnce({ user: { id: "u-1" } });
    state.prisma.user.findUnique.mockResolvedValueOnce({
      isActive: false,
      orgId: "org-1",
      role: "USER",
      emailVerifiedByProvider: null,
    });

    mod = await loadAuthModule();
    await expect(mod.auth()).resolves.toBeNull();

    state.nextAuthAuth.mockResolvedValueOnce(null);
    mod = await loadAuthModule();
    await expect(mod.auth()).resolves.toBeNull();
  });
});
