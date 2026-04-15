import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateToken } from "@/lib/tokens";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import {
  buildTelegramLoginLinks,
  createTelegramLoginToken,
  readTelegramLoginStatus,
} from "@/lib/telegram-login";

const EXPIRY_MINUTES = 10;
const LOGIN_TOKEN_LIMIT = 5;
const LOGIN_TOKEN_WINDOW_MS = 60 * 1000;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim() ?? "";

  if (!token) {
    return NextResponse.json(
      {
        state: "error",
        code: "TOKEN_REQUIRED",
      },
      { status: 400 }
    );
  }

  const status = await readTelegramLoginStatus({ prisma, token });
  return NextResponse.json(status);
}

export async function POST(request: Request) {
  const botName = process.env.TELEGRAM_LOGIN_BOT_NAME?.trim();
  if (!botName) {
    return NextResponse.json(
      {
        error: "Telegram login is unavailable",
        code: "TELEGRAM_LOGIN_DISABLED",
      },
      { status: 503 }
    );
  }

  const clientIp = getClientIp(request);
  const rate = await checkRateLimit({
    key: `auth:telegram-login:create:${clientIp}`,
    limit: LOGIN_TOKEN_LIMIT,
    windowMs: LOGIN_TOKEN_WINDOW_MS,
  });

  if (!rate.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000);

  await createTelegramLoginToken({
    prisma,
    token,
    expiresAt,
  });

  return NextResponse.json({
    token,
    expiresAt,
    ...buildTelegramLoginLinks(botName, token),
  });
}
