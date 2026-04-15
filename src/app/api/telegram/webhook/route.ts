import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const providedSecret = request.headers.get("x-telegram-bot-api-secret-token");

  if (!expectedSecret) {
    return NextResponse.json(
      {
        ok: false,
        error: "TELEGRAM_WEBHOOK_DISABLED",
        message:
          "Webhook mode is not configured. Run the bot in polling mode until a webhook handler is implemented.",
      },
      { status: 503 }
    );
  }

  if (expectedSecret && providedSecret !== expectedSecret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = await request.json().catch(() => null);
  if (!update) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  return NextResponse.json(
    {
      ok: false,
      error: "TELEGRAM_WEBHOOK_NOT_IMPLEMENTED",
      message:
        "Webhook requests are rejected intentionally because update handling is not implemented in this route.",
    },
    { status: 503 }
  );
}
