import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { recordStripeWebhookEvent } from "@/lib/stripe-webhook";

function parseCompletedCheckoutMetadata(session: {
  id?: string;
  metadata?: Record<string, string>;
}) {
  const userId = session.metadata?.userId?.trim();
  const creditsRaw = session.metadata?.credits?.trim();
  const credits = Number(creditsRaw ?? Number.NaN);

  if (!userId || !Number.isFinite(credits) || credits <= 0) {
    throw new Error("Invalid checkout.session.completed metadata");
  }

  return {
    userId,
    credits,
    sessionId: session.id ?? null,
  };
}

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
    let checkout;
    try {
      checkout = parseCompletedCheckoutMetadata(session);
    } catch (error) {
      console.error("Stripe webhook rejected malformed checkout metadata", {
        eventId: event.id,
        sessionId: session.id ?? null,
        error: error instanceof Error ? error.message : "Invalid metadata",
      });
      return NextResponse.json(
        { error: "Invalid checkout metadata" },
        { status: 500 }
      );
    }

    const eventId = event.id;
    const sessionId = checkout.sessionId;
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

      const user = await tx.user.findUnique({
        where: { id: checkout.userId },
        select: { costCenterId: true },
      });

      if (!user) {
        throw new Error("Stripe webhook references unknown user");
      }

      await tx.user.update({
        where: { id: checkout.userId },
        data: { balance: { increment: checkout.credits } },
      });

      await tx.transaction.create({
        data: {
          userId: checkout.userId,
          costCenterId: user.costCenterId ?? undefined,
          amount: checkout.credits,
          type: "REFILL",
          description: "Stripe пополнение",
          externalId: event.id,
        },
      });

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
