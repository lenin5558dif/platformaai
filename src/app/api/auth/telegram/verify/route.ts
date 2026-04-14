import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyTelegramLogin } from "@/lib/telegram";
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

  return NextResponse.json({ ok: true });
}
