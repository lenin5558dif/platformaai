import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getBillingPlan, getPlanStripePriceId, resolveBillingPlanId } from "@/lib/plans";
import { checkRateLimit } from "@/lib/rate-limit";
import { getStripe } from "@/lib/stripe";

const schema = z.object({
  planId: z.string().transform((value, ctx) => {
    const planId = resolveBillingPlanId(value);
    if (!planId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unknown plan",
      });
      return z.NEVER;
    }
    return planId;
  }),
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rate = await checkRateLimit({
    key: `stripe:subscription:${session.user.id}`,
    limit: 5,
    windowMs: 60 * 1000,
  });

  if (!rate.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const payload = schema.parse(await request.json());
  const staticPlan = getBillingPlan(payload.planId);
  if (!staticPlan || staticPlan.monthlyPriceUsd <= 0 || !staticPlan.renewalEnabled) {
    return NextResponse.json({ error: "Plan is not purchasable" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      email: true,
      subscription: {
        select: {
          stripeCustomerId: true,
        },
      },
    },
  });

  if (!user?.email) {
    return NextResponse.json({ error: "User email is required" }, { status: 400 });
  }

  const dbPlan = await prisma.billingPlan.findUnique({
    where: { code: payload.planId },
    select: {
      code: true,
      stripePriceId: true,
      isActive: true,
    },
  });

  if (!dbPlan?.isActive) {
    return NextResponse.json({ error: "Plan is unavailable" }, { status: 404 });
  }

  const stripePriceId = getPlanStripePriceId(payload.planId, dbPlan.stripePriceId);
  if (!stripePriceId) {
    return NextResponse.json(
      { error: "Stripe price is not configured for this plan" },
      { status: 503 }
    );
  }

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

  const metadata = {
    userId: session.user.id,
    planId: payload.planId,
  };

  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price: stripePriceId,
        quantity: 1,
      },
    ],
    ...(user.subscription?.stripeCustomerId
      ? { customer: user.subscription.stripeCustomerId }
      : { customer_email: user.email }),
    metadata,
    subscription_data: {
      metadata,
    },
    success_url: `${appUrl}/billing?subscription=success`,
    cancel_url: `${appUrl}/pricing?subscription=canceled`,
  });

  return NextResponse.json({ url: checkout.url });
}
