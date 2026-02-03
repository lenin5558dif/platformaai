import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateToken } from "@/lib/tokens";
import { checkRateLimit } from "@/lib/rate-limit";
import * as bcrypt from "bcryptjs";

const EXPIRY_MINUTES = 10;
const TOKEN_PREFIX_LEN = 16;

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
  const tokenPrefix = token.slice(0, TOKEN_PREFIX_LEN);
  const telegramLinkTokenHash = bcrypt.hashSync(token, 10);
  const record = await prisma.telegramLinkToken.create({
    data: {
      token: tokenPrefix,
      telegramLinkTokenHash,
      userId: session.user.id,
      expiresAt,
    },
  });

  const botName = process.env.TELEGRAM_LOGIN_BOT_NAME ?? "platformaai_bot";
  const deepLink = `https://t.me/${botName}?start=${token}`;

  return NextResponse.json({ token, deepLink, expiresAt });
}
