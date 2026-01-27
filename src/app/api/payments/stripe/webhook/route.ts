import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook secret not set" }, { status: 500 });
  }

  const payload = await request.text();
  const stripe = getStripe();

  let event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid signature" },
      { status: 400 }
    );
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as {
      metadata?: Record<string, string>;
    };
    const credits = Number(session.metadata?.credits ?? 0);
    const userId = session.metadata?.userId;

    if (credits > 0 && userId) {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.transaction.findUnique({
          where: { externalId: event.id },
          select: { id: true },
        });

        if (existing) {
          return;
        }

        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { costCenterId: true },
        });

        await tx.user.update({
          where: { id: userId },
          data: { balance: { increment: credits } },
        });

        await tx.transaction.create({
          data: {
            userId,
            costCenterId: user?.costCenterId ?? undefined,
            amount: credits,
            type: "REFILL",
            description: "Stripe пополнение",
            externalId: event.id,
          },
        });
      });
    }
  }

  return NextResponse.json({ received: true });
}
