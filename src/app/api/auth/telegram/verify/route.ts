import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyTelegramLogin } from "@/lib/telegram";
import { getTelegramAuthConfig } from "@/lib/telegram-auth-config";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const schema = z.object({
  id: z.number(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.number(),
  hash: z.string(),
});

export async function POST(request: Request) {
  if (!getTelegramAuthConfig().enabled) {
    return NextResponse.json(
      { ok: false, error: "Telegram auth is not configured" },
      { status: 503 }
    );
  }

  const ip = getClientIp(request);
  const rate = await checkRateLimit({
    key: `tg-verify:${ip}`,
    limit: 20,
    windowMs: 60 * 1000,
  });

  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many requests" },
      { status: 429 }
    );
  }
  const body = await request.json();
  const payload = schema.parse(body);

  const isValid = verifyTelegramLogin(
    payload,
    process.env.TELEGRAM_BOT_TOKEN ?? ""
  );

  if (!isValid) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { telegramId: String(payload.id) },
    select: { id: true },
  });

  if (!user) {
    return NextResponse.json(
      {
        ok: false,
        error: "Telegram account is not linked",
        code: "ACCOUNT_NOT_LINKED",
      },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
