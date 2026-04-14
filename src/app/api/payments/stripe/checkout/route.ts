import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { checkRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  credits: z.number().positive().max(100000),
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rate = await checkRateLimit({
    key: `stripe:${session.user.id}`,
    limit: 5,
    windowMs: 60 * 1000,
  });

  if (!rate.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const payload = schema.parse(await request.json());
  const usdPerCredit = Number(process.env.USD_PER_CREDIT ?? 0.01);
  const amountUsd = payload.credits * usdPerCredit;
  const unitAmount = Math.max(1, Math.round(amountUsd * 100));

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000";

  let stripe;
  try {
    stripe = getStripe();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Stripe not configured" },
      { status: 500 }
    );
  }

  const checkout = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: unitAmount,
          product_data: {
            name: `PlatformaAI credits (${payload.credits})`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      userId: session.user.id,
      credits: payload.credits.toString(),
    },
    success_url: `${appUrl}/profile?success=1`,
    cancel_url: `${appUrl}/profile?canceled=1`,
  });

  return NextResponse.json({ url: checkout.url });
}
