import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import {
  BILLING_TIER_IDS,
  getBillingTierIncludedCredits,
  getBillingTierLabel,
  getBillingTierPriceRub,
} from "@/lib/billing-tiers";

const schema = z.object({
  billingTier: z.enum(BILLING_TIER_IDS).refine((value) => value !== "free", {
    message: "Paid billing tier is required",
  }),
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

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      email: true,
      emailVerifiedByProvider: true,
    },
  });

  if (!user?.email) {
    return NextResponse.json(
      { error: "Добавьте email в настройках перед покупкой тарифа." },
      { status: 403 }
    );
  }

  if (user.emailVerifiedByProvider !== true) {
    return NextResponse.json(
      { error: "Подтвердите email в настройках перед покупкой тарифа." },
      { status: 403 }
    );
  }

  const payload = schema.parse(await request.json());
  const priceRub = getBillingTierPriceRub(payload.billingTier);
  const credits = getBillingTierIncludedCredits(payload.billingTier);
  const planLabel = getBillingTierLabel(payload.billingTier);
  const unitAmount = Math.max(100, Math.round(priceRub * 100));

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
          currency: "rub",
          unit_amount: unitAmount,
          product_data: {
            name: `PlatformaAI • ${planLabel}`,
            description: `${credits} кредитов и доступ к платным моделям`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      userId: session.user.id,
      credits: credits.toString(),
      billingTier: payload.billingTier,
      billingTierLabel: planLabel,
      priceRub: priceRub.toString(),
    },
    success_url: `${appUrl}/settings?success=1`,
    cancel_url: `${appUrl}/settings?canceled=1`,
  });

  return NextResponse.json({ url: checkout.url });
}
