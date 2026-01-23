import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { verifyTelegramLogin } from "@/lib/telegram";
import { checkRateLimit } from "@/lib/rate-limit";

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
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const rate = checkRateLimit({
    key: `tg-link:${session.user.id}`,
    limit: 10,
    windowMs: 60 * 1000,
  });

  if (!rate.ok) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const payload = schema.parse(await request.json());
  const isValid = verifyTelegramLogin(
    payload,
    process.env.TELEGRAM_BOT_TOKEN ?? ""
  );

  if (!isValid) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { telegramId: String(payload.id) },
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
