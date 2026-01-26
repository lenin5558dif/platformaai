import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { recordStripeWebhookEvent } from "@/lib/stripe-webhook";

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
      id?: string;
      metadata?: Record<string, string>;
    };
    const credits = Number(session.metadata?.credits ?? 0);
    const userId = session.metadata?.userId;
    const eventId = event.id;
    const sessionId = session.id ?? null;
    const result = await prisma.$transaction(async (tx) => {
      const recorded = await recordStripeWebhookEvent({
        eventId,
        eventType: event.type,
        sessionId,
        client: tx,
      });
      if (!recorded) {
        return { duplicate: true };
      }

      if (credits > 0 && userId) {
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
          },
        });
      }

      return { duplicate: false };
    });

    if (result?.duplicate) {
      console.warn("Stripe webhook duplicate ignored", {
        eventId,
        eventType: event.type,
        sessionId,
      });
    }
  }

  return NextResponse.json({ received: true });
}
