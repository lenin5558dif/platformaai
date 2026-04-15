import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  buildTelegramLoginLinks,
  buildTelegramLoginStartToken,
  completeTelegramLogin,
  consumeTelegramLoginToken,
  extractTelegramLoginToken,
  parseTelegramLoginStatus,
} from "@/lib/telegram-login";

const state = vi.hoisted(() => ({
  record: {
    identifier: "telegram-login:pending",
    expires: new Date("2026-04-15T12:10:00.000Z"),
  },
  userByTelegramId: null as null | { id: string; isActive: boolean },
  userById: null as null | any,
}));

const prisma = {
  verificationToken: {
    findUnique: vi.fn(async () => state.record),
    update: vi.fn(async () => ({ ok: true })),
    delete: vi.fn(async () => ({ ok: true })),
  },
  user: {
    findUnique: vi.fn(async (args: any) => {
      if (args.where?.telegramId) {
        return state.userByTelegramId;
      }
      if (args.where?.id) {
        return state.userById;
      }
      return null;
    }),
  },
} as any;

describe("telegram app login helpers", () => {
  beforeEach(() => {
    state.record = {
      identifier: "telegram-login:pending",
      expires: new Date("2026-04-15T12:10:00.000Z"),
    };
    state.userByTelegramId = null;
    state.userById = null;
    vi.clearAllMocks();
  });

  test("builds app and web deep links", () => {
    const links = buildTelegramLoginLinks("dontnikolaybot", "abc123");
    expect(links.deepLink).toBe("https://t.me/dontnikolaybot?start=login_abc123");
    expect(links.appDeepLink).toBe("tg://resolve?domain=dontnikolaybot&start=login_abc123");
  });

  test("extracts prefixed login token", () => {
    expect(buildTelegramLoginStartToken("abc123")).toBe("login_abc123");
    expect(extractTelegramLoginToken("login_abc123")).toBe("abc123");
    expect(extractTelegramLoginToken("abc123")).toBeNull();
  });

  test("parses confirmed status", () => {
    const status = parseTelegramLoginStatus({
      identifier: "telegram-login:confirmed:user_1",
      expires: new Date("2026-04-15T12:10:00.000Z"),
    }, new Date("2026-04-15T12:00:00.000Z"));

    expect(status).toEqual({
      state: "ready",
      userId: "user_1",
      expiresAt: new Date("2026-04-15T12:10:00.000Z"),
    });
  });

  test("marks token as confirmed for a linked Telegram user", async () => {
    state.userByTelegramId = { id: "user_1", isActive: true };

    const result = await completeTelegramLogin({
      prisma,
      token: "token_1",
      telegramId: "123",
      now: new Date("2026-04-15T12:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    expect(prisma.verificationToken.update).toHaveBeenCalledWith({
      where: { token: "token_1" },
      data: {
        identifier: "telegram-login:confirmed:user_1",
      },
    });
  });

  test("stores not-linked error for unknown Telegram accounts", async () => {
    const result = await completeTelegramLogin({
      prisma,
      token: "token_1",
      telegramId: "999",
      now: new Date("2026-04-15T12:00:00.000Z"),
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("ACCOUNT_NOT_LINKED");
    expect(prisma.verificationToken.update).toHaveBeenCalledWith({
      where: { token: "token_1" },
      data: {
        identifier: "telegram-login:error:ACCOUNT_NOT_LINKED",
      },
    });
  });

  test("consumes confirmed token into a web session user", async () => {
    state.record = {
      identifier: "telegram-login:confirmed:user_1",
      expires: new Date("2026-04-15T12:10:00.000Z"),
    };
    state.userById = {
      id: "user_1",
      email: "user@example.com",
      role: "USER",
      orgId: "org_1",
      balance: { toString: () => "12" },
      isActive: true,
      emailVerifiedByProvider: null,
    };

    const result = await consumeTelegramLoginToken({
      prisma,
      token: "token_1",
      now: new Date("2026-04-15T12:00:00.000Z"),
    });

    expect(result?.id).toBe("user_1");
    expect(prisma.verificationToken.delete).toHaveBeenCalledWith({
      where: { token: "token_1" },
    });
  });
});
