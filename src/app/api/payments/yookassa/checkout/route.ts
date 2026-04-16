import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import {
  BILLING_TIER_IDS,
  getBillingTierIncludedCredits,
  getBillingTierLabel,
  getBillingTierPriceRub,
} from "@/lib/billing-tiers";
import { createYookassaPayment, getYookassaReturnUrl } from "@/lib/yookassa";

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
    key: `yookassa:${session.user.id}`,
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
  const returnUrl = getYookassaReturnUrl();

  const payment = await createYookassaPayment({
    amountRub: priceRub,
    description: `PlatformaAI • ${planLabel}`,
    returnUrl,
    metadata: {
      userId: session.user.id,
      credits: credits.toString(),
      billingTier: payload.billingTier,
      billingTierLabel: planLabel,
      priceRub: priceRub.toString(),
    },
    idempotenceKey: randomUUID(),
  });

  const confirmationUrl = payment.confirmation?.confirmation_url;
  if (!confirmationUrl) {
    return NextResponse.json(
      { error: "YooKassa confirmation url is missing" },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: confirmationUrl, paymentId: payment.id });
}
