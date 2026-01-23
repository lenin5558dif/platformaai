import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateToken } from "@/lib/tokens";
import { checkRateLimit } from "@/lib/rate-limit";

const EXPIRY_MINUTES = 30;

export async function POST() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rate = checkRateLimit({
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
  const record = await prisma.telegramLinkToken.create({
    data: {
      token,
      userId: session.user.id,
      expiresAt,
    },
  });

  const botName = process.env.TELEGRAM_LOGIN_BOT_NAME ?? "platformaai_bot";
  const deepLink = `https://t.me/${botName}?start=${record.token}`;

  return NextResponse.json({ token: record.token, deepLink, expiresAt });
}
