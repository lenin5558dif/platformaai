import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateToken } from "@/lib/tokens";
import { checkRateLimit } from "@/lib/rate-limit";
import { maskEmail } from "@/lib/telegram-linking";
import * as bcrypt from "bcryptjs";

const EXPIRY_MINUTES = 10;
const TOKEN_PREFIX_LEN = 16;

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const tokenPrefix = token.slice(0, TOKEN_PREFIX_LEN);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      email: true,
      telegramId: true,
      org: {
        select: {
          name: true,
        },
      },
    },
  });

  const identityHint = {
    maskedEmail: user?.email ? maskEmail(user.email) : null,
    orgName: user?.org?.name ?? null,
  };

  if (!tokenPrefix) {
    return NextResponse.json({
      state: user?.telegramId ? "linked" : "idle",
      telegramId: user?.telegramId ?? null,
      ...identityHint,
    });
  }

  const record = await prisma.telegramLinkToken.findFirst({
    where: {
      userId: session.user.id,
      token: tokenPrefix,
    },
    select: {
      id: true,
      usedAt: true,
      expiresAt: true,
    },
  });

  if (!record) {
    return NextResponse.json({
      state: user?.telegramId ? "linked" : "error",
      code: user?.telegramId ? undefined : "INVALID_TOKEN",
      telegramId: user?.telegramId ?? null,
      ...identityHint,
    });
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    return NextResponse.json({
      state: "error",
      code: "TOKEN_EXPIRED",
      telegramId: user?.telegramId ?? null,
      ...identityHint,
    });
  }

  if (record.usedAt) {
    return NextResponse.json({
      state: user?.telegramId ? "linked" : "error",
      code: user?.telegramId ? undefined : "TOKEN_USED_OR_CONFLICT",
      telegramId: user?.telegramId ?? null,
      ...identityHint,
    });
  }

  return NextResponse.json({
    state: "awaiting_bot_confirmation",
    code: null,
    expiresAt: record.expiresAt,
    telegramId: user?.telegramId ?? null,
    ...identityHint,
  });
}

export async function POST() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rate = await checkRateLimit({
    key: `tg-token:${session.user.id}`,
    limit: 5,
    windowMs: 60 * 1000,
  });

  if (!rate.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + EXPIRY_MINUTES * 60 * 1000);

  await prisma.telegramLinkToken.deleteMany({
    where: {
      userId: session.user.id,
    },
  });

  const token = generateToken();
  const tokenPrefix = token.slice(0, TOKEN_PREFIX_LEN);
  const telegramLinkTokenHash = bcrypt.hashSync(token, 10);
  await prisma.telegramLinkToken.create({
    data: {
      token: tokenPrefix,
      telegramLinkTokenHash,
      userId: session.user.id,
      expiresAt,
    },
  });

  const botName = process.env.TELEGRAM_LOGIN_BOT_NAME ?? "platformaai_bot";
  const deepLink = `https://t.me/${botName}?start=${token}`;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      email: true,
      org: {
        select: {
          name: true,
        },
      },
    },
  });

  return NextResponse.json({
    token,
    deepLink,
    expiresAt,
    maskedEmail: user?.email ? maskEmail(user.email) : null,
    orgName: user?.org?.name ?? null,
  });
}
