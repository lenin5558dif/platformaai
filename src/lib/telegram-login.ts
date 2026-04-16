import type { PrismaClient } from "@prisma/client";

const TELEGRAM_LOGIN_START_PREFIX = "login_";
const TELEGRAM_LOGIN_PENDING_IDENTIFIER = "telegram-login:pending";
const TELEGRAM_LOGIN_CONFIRMED_PREFIX = "telegram-login:confirmed:";
const TELEGRAM_LOGIN_ERROR_PREFIX = "telegram-login:error:";

type VerificationTokenClient = Pick<
  PrismaClient,
  "verificationToken" | "user"
>;

export type TelegramLoginStatus =
  | { state: "pending"; expiresAt: Date }
  | { state: "ready"; userId: string; expiresAt: Date }
  | { state: "error"; code: string; expiresAt?: Date | null };

export function buildTelegramLoginStartToken(token: string) {
  return `${TELEGRAM_LOGIN_START_PREFIX}${token}`;
}

export function extractTelegramLoginToken(value: string) {
  if (!value.startsWith(TELEGRAM_LOGIN_START_PREFIX)) {
    return null;
  }

  const token = value.slice(TELEGRAM_LOGIN_START_PREFIX.length).trim();
  return token || null;
}

export function buildTelegramLoginLinks(botName: string, token: string) {
  const startToken = buildTelegramLoginStartToken(token);
  return {
    deepLink: `https://t.me/${botName}?start=${startToken}`,
    appDeepLink: `tg://resolve?domain=${botName}&start=${startToken}`,
  };
}

export function parseTelegramLoginStatus(record: {
  identifier: string;
  expires: Date;
} | null, now = new Date()): TelegramLoginStatus {
  if (!record) {
    return { state: "error", code: "INVALID_TOKEN", expiresAt: null };
  }

  if (record.expires.getTime() <= now.getTime()) {
    return { state: "error", code: "TOKEN_EXPIRED", expiresAt: record.expires };
  }

  if (record.identifier === TELEGRAM_LOGIN_PENDING_IDENTIFIER) {
    return { state: "pending", expiresAt: record.expires };
  }

  if (record.identifier.startsWith(TELEGRAM_LOGIN_CONFIRMED_PREFIX)) {
    const userId = record.identifier.slice(TELEGRAM_LOGIN_CONFIRMED_PREFIX.length);
    if (userId) {
      return { state: "ready", userId, expiresAt: record.expires };
    }
  }

  if (record.identifier.startsWith(TELEGRAM_LOGIN_ERROR_PREFIX)) {
    return {
      state: "error",
      code: record.identifier.slice(TELEGRAM_LOGIN_ERROR_PREFIX.length) || "LOGIN_FAILED",
      expiresAt: record.expires,
    };
  }

  return { state: "error", code: "INVALID_TOKEN", expiresAt: record.expires };
}

export async function createTelegramLoginToken(args: {
  prisma: VerificationTokenClient;
  token: string;
  expiresAt: Date;
}) {
  return args.prisma.verificationToken.create({
    data: {
      identifier: TELEGRAM_LOGIN_PENDING_IDENTIFIER,
      token: args.token,
      expires: args.expiresAt,
    },
  });
}

export async function readTelegramLoginStatus(args: {
  prisma: VerificationTokenClient;
  token: string;
  now?: Date;
}) {
  const record = await args.prisma.verificationToken.findUnique({
    where: { token: args.token },
    select: {
      identifier: true,
      expires: true,
    },
  });

  return parseTelegramLoginStatus(record, args.now);
}

export async function completeTelegramLogin(args: {
  prisma: VerificationTokenClient;
  token: string;
  telegramId: string;
  telegramUsername?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const status = await readTelegramLoginStatus({
    prisma: args.prisma,
    token: args.token,
    now,
  });

  if (status.state === "error") {
    return {
      ok: false as const,
      code: status.code,
      message:
        status.code === "TOKEN_EXPIRED"
          ? "Ссылка для входа истекла. Запросите новую на сайте."
          : "Не удалось подтвердить вход. Запросите новую ссылку на сайте.",
    };
  }

  if (status.state === "ready") {
    return {
      ok: true as const,
      code: "ALREADY_CONFIRMED",
      message: "Вход уже подтвержден. Вернитесь в браузер PlatformaAI.",
    };
  }

  let user = await args.prisma.user.findUnique({
    where: { telegramId: args.telegramId },
    select: { id: true, isActive: true },
  });

  if (!user) {
    const profileName = [args.firstName?.trim(), args.lastName?.trim()]
      .filter(Boolean)
      .join(" ")
      .trim();

    user = await args.prisma.user.create({
      data: {
        telegramId: args.telegramId,
        role: "USER",
        settings: {
          onboarded: true,
          billingTier: "free",
          planName: "Free",
          profileFirstName:
            profileName || args.telegramUsername?.trim() || "Telegram User",
        },
      },
      select: { id: true, isActive: true },
    });
  }

  if (user.isActive === false) {
    await args.prisma.verificationToken.update({
      where: { token: args.token },
      data: {
        identifier: `${TELEGRAM_LOGIN_ERROR_PREFIX}ACCOUNT_INACTIVE`,
      },
    });

    return {
      ok: false as const,
      code: "ACCOUNT_INACTIVE",
      message: "Этот аккаунт отключен. Обратитесь к администратору.",
    };
  }

  await args.prisma.verificationToken.update({
    where: { token: args.token },
    data: {
      identifier: `${TELEGRAM_LOGIN_CONFIRMED_PREFIX}${user.id}`,
    },
  });

  return {
    ok: true as const,
    code: "CONFIRMED",
    userId: user.id,
    message: "Вход подтвержден. Аккаунт готов, возвращайтесь в браузер PlatformaAI.",
  };
}

export async function consumeTelegramLoginToken(args: {
  prisma: VerificationTokenClient;
  token: string;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const record = await args.prisma.verificationToken.findUnique({
    where: { token: args.token },
    select: {
      identifier: true,
      expires: true,
    },
  });
  const status = parseTelegramLoginStatus(record, now);

  if (status.state !== "ready") {
    return null;
  }

  const user = await args.prisma.user.findUnique({
    where: { id: status.userId },
    select: {
      id: true,
      email: true,
      role: true,
      orgId: true,
      balance: true,
      isActive: true,
      emailVerifiedByProvider: true,
    },
  });

  await args.prisma.verificationToken.delete({
    where: { token: args.token },
  });

  if (!user || user.isActive === false) {
    return null;
  }

  return user;
}
