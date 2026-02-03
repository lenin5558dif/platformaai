import type { PrismaClient } from "@prisma/client";
import { AuditAction } from "@prisma/client";
import { buildTelegramLinkAuditMetadata } from "@/lib/telegram-audit";
import {
  buildTelegramLinkConfirmationPrompt,
  getTelegramLinkTokenPrefix,
  isTelegramLinkTokenMatch,
  maskEmail,
} from "@/lib/telegram-linking";

export async function beginTelegramLink(params: {
  prisma: PrismaClient;
  token: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const tokenPrefix = getTelegramLinkTokenPrefix(params.token);

  const record = await params.prisma.telegramLinkToken.findFirst({
    where: {
      OR: [{ token: params.token }, { token: tokenPrefix }],
    },
    include: { user: true },
  });

  if (!record || record.usedAt || record.expiresAt < now) {
    return { ok: false as const, message: "Токен недействителен или истек. Сгенерируйте новый." };
  }

  const matches = isTelegramLinkTokenMatch({
    incomingToken: params.token,
    recordToken: record.token,
    recordHash: record.telegramLinkTokenHash,
  });

  if (!matches) {
    return { ok: false as const, message: "Токен недействителен или истек. Сгенерируйте новый." };
  }

  const masked = maskEmail(record.user?.email);
  const prompt = buildTelegramLinkConfirmationPrompt({
    maskedEmail: masked,
    tokenId: record.id,
  });

  return {
    ok: true as const,
    tokenId: record.id,
    prompt,
    userId: record.userId,
    orgId: record.user?.orgId ?? null,
    userEmailMasked: masked,
  };
}

export async function confirmTelegramLink(params: {
  prisma: PrismaClient;
  tokenId: string;
  telegramId: string;
  now?: Date;
  logAudit: (args: {
    action: AuditAction;
    orgId?: string | null;
    actorId?: string | null;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: any;
  }) => Promise<void>;
}) {
  const now = params.now ?? new Date();
  const record = await params.prisma.telegramLinkToken.findUnique({
    where: { id: params.tokenId },
    include: { user: true },
  });

  if (!record || record.usedAt || record.expiresAt < now) {
    return { ok: false as const, message: "Токен недействителен или истек. Сгенерируйте новый." };
  }

  const existing = await params.prisma.user.findUnique({
    where: { telegramId: params.telegramId },
    select: { id: true },
  });

  if (existing && existing.id !== record.userId) {
    await params.prisma.telegramLinkToken.update({
      where: { id: record.id },
      data: { usedAt: now },
    });
    return { ok: false as const, message: "Этот Telegram уже привязан к другому аккаунту." };
  }

  await params.prisma.user.update({
    where: { id: record.userId },
    data: {
      telegramId: params.telegramId,
      globalRevokeCounter: 0,
    },
  });

  await params.prisma.telegramLinkToken.update({
    where: { id: record.id },
    data: { usedAt: now },
  });

  await params.logAudit({
    action: AuditAction.TELEGRAM_LINKED,
    orgId: record.user?.orgId ?? undefined,
    actorId: record.userId,
    targetType: "User",
    targetId: record.userId,
    metadata: buildTelegramLinkAuditMetadata({
      telegramId: params.telegramId,
      source: "bot",
      maskedEmail: maskEmail(record.user?.email),
    }),
  });

  return { ok: true as const };
}

export async function cancelTelegramLink(params: {
  prisma: PrismaClient;
  tokenId: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  await params.prisma.telegramLinkToken.update({
    where: { id: params.tokenId },
    data: { usedAt: now },
  });
  return { ok: true as const };
}
