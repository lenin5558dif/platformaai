import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  getYookassaWebhookEventId,
  parseYookassaSucceededNotification,
  recordYookassaWebhookEvent,
} from "@/lib/yookassa-webhook";
import { mergeSettings } from "@/lib/user-settings";

function parsePaymentMetadata(payment: {
  id?: string;
  metadata?: Record<string, string>;
}) {
  const userId = payment.metadata?.userId?.trim();
  const creditsRaw = payment.metadata?.credits?.trim();
  const credits = Number(creditsRaw ?? Number.NaN);
  const billingTier = payment.metadata?.billingTier?.trim() ?? null;
  const billingTierLabel = payment.metadata?.billingTierLabel?.trim() ?? null;

  if (!userId || !Number.isFinite(credits) || credits <= 0) {
    throw new Error("Invalid payment.succeeded metadata");
  }

  return {
    userId,
    credits,
    billingTier,
    billingTierLabel,
    paymentId: payment.id ?? null,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ secret: string }> }
) {
  const secret = (await params).secret;
  const expectedSecret = process.env.YOOKASSA_WEBHOOK_SECRET;

  if (!expectedSecret) {
    return NextResponse.json({ error: "Webhook secret not set" }, { status: 500 });
  }

  if (secret !== expectedSecret) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let notification;
  try {
    notification = parseYookassaSucceededNotification(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook payload";
    if (message === "Unsupported YooKassa webhook event") {
      return NextResponse.json({ received: true });
    }

    return NextResponse.json({ error: message }, { status: 400 });
  }

  let checkout;
  try {
    checkout = parsePaymentMetadata(notification.object);
  } catch (error) {
    console.error("YooKassa webhook rejected malformed payment metadata", {
      eventId: notification.event,
      paymentId: notification.object.id ?? null,
      error: error instanceof Error ? error.message : "Invalid metadata",
    });
    return NextResponse.json({ error: "Invalid payment metadata" }, { status: 500 });
  }

  const eventId = getYookassaWebhookEventId(notification);
  const paymentId = checkout.paymentId;

  const result = await prisma.$transaction(async (tx) => {
    const recorded = await recordYookassaWebhookEvent({
      eventId,
      eventType: notification.event,
      paymentId,
      client: tx,
    });

    if (!recorded) {
      return { duplicate: true };
    }

    const user = await tx.user.findUnique({
      where: { id: checkout.userId },
      select: { costCenterId: true, settings: true },
    });

    if (!user) {
      throw new Error("YooKassa webhook references unknown user");
    }

    await tx.user.update({
      where: { id: checkout.userId },
      data: {
        balance: { increment: checkout.credits },
        settings:
          checkout.billingTier && checkout.billingTierLabel
            ? mergeSettings(user.settings, {
                billingTier: checkout.billingTier,
                planName: checkout.billingTierLabel,
              })
            : undefined,
      },
    });

    await tx.transaction.create({
      data: {
        userId: checkout.userId,
        costCenterId: user.costCenterId ?? undefined,
        amount: checkout.credits,
        type: "REFILL",
        description: checkout.billingTierLabel
          ? `ЮKassa пополнение • ${checkout.billingTierLabel}`
          : "ЮKassa пополнение",
        externalId: paymentId ?? notification.object.id ?? eventId,
      },
    });

    return { duplicate: false };
  });

  if (result?.duplicate) {
    console.warn("YooKassa webhook duplicate ignored", {
      eventId,
      paymentId,
    });
  }

  return NextResponse.json({ received: true });
}
