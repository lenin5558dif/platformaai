import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { recordStripeWebhookEvent } from "@/lib/stripe-webhook";
import { getPlanStripePriceId } from "@/lib/plans";

function toDateFromUnix(value?: number | null) {
  if (!value) return null;
  return new Date(value * 1000);
}

function readUnixField(value: unknown, key: string) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" ? candidate : null;
}

function readNestedString(value: unknown, path: string[]) {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" ? current : null;
}

function readInvoiceSubscriptionId(invoice: unknown) {
  return (
    readNestedString(invoice, ["subscription"]) ??
    readNestedString(invoice, ["parent", "subscription_details", "subscription"])
  );
}

function mapStripeSubscriptionStatus(
  status?: string | null
): "ACTIVE" | "CANCELED" | "PAST_DUE" | "INCOMPLETE" | "TRIALING" {
  switch (status) {
    case "trialing":
      return "TRIALING";
    case "past_due":
    case "unpaid":
      return "PAST_DUE";
    case "incomplete":
    case "incomplete_expired":
      return "INCOMPLETE";
    case "canceled":
      return "CANCELED";
    case "active":
    default:
      return "ACTIVE";
  }
}

async function resolvePlanForSubscription(params: {
  tx: typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
  planId?: string | null;
  priceId?: string | null;
}) {
  if (params.planId) {
    const plan = await params.tx.billingPlan.findUnique({
      where: { code: params.planId },
      select: {
        id: true,
        code: true,
        includedCreditsPerMonth: true,
      },
    });
    if (plan) {
      return plan;
    }
  }

  if (params.priceId) {
    const plan = await params.tx.billingPlan.findFirst({
      where: {
        OR: [
          { stripePriceId: params.priceId },
          { code: "creator" },
          { code: "pro" },
        ],
      },
      select: {
        id: true,
        code: true,
        stripePriceId: true,
        includedCreditsPerMonth: true,
      },
      orderBy: { createdAt: "asc" },
    });

    if (plan?.stripePriceId === params.priceId) {
      return plan;
    }

    if (plan && getPlanStripePriceId(plan.code as "creator" | "pro", plan.stripePriceId) === params.priceId) {
      return plan;
    }
  }

  return null;
}

async function upsertSubscriptionFromStripe(params: {
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
  subscription:
    | Stripe.Subscription
    | {
        id?: string | null;
        customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
        status?: string | null;
        current_period_start?: number | null;
        current_period_end?: number | null;
        cancel_at_period_end?: boolean | null;
        metadata?: Record<string, string>;
        items?: {
          data?: Array<{
            price?: {
              id?: string | null;
            } | null;
          }>;
        };
      };
  resetUsage?: boolean;
}) {
  const stripeSubscriptionId = params.subscription.id ?? null;
  const metadata = params.subscription.metadata ?? {};
  const customer =
    typeof params.subscription.customer === "string"
      ? params.subscription.customer
      : params.subscription.customer?.id ?? null;
  const priceId = params.subscription.items?.data?.[0]?.price?.id ?? null;
  const plan = await resolvePlanForSubscription({
    tx: params.tx,
    planId: metadata.planId,
    priceId,
  });

  if (!stripeSubscriptionId || !metadata.userId || !plan) {
    return;
  }

  const currentPeriodStart =
    toDateFromUnix(readUnixField(params.subscription, "current_period_start")) ?? new Date();
  const currentPeriodEnd =
    toDateFromUnix(readUnixField(params.subscription, "current_period_end")) ?? currentPeriodStart;

  await params.tx.userSubscription.upsert({
    where: { userId: metadata.userId },
    update: {
      planId: plan.id,
      status: mapStripeSubscriptionStatus(params.subscription.status),
      currentPeriodStart,
      currentPeriodEnd,
      includedCredits: plan.includedCreditsPerMonth,
      ...(params.resetUsage ? { includedCreditsUsed: 0 } : {}),
      stripeCustomerId: customer,
      stripeSubscriptionId,
      cancelAtPeriodEnd: Boolean(params.subscription.cancel_at_period_end),
    },
    create: {
      userId: metadata.userId,
      planId: plan.id,
      status: mapStripeSubscriptionStatus(params.subscription.status),
      currentPeriodStart,
      currentPeriodEnd,
      includedCredits: plan.includedCreditsPerMonth,
      includedCreditsUsed: 0,
      stripeCustomerId: customer,
      stripeSubscriptionId,
      cancelAtPeriodEnd: Boolean(params.subscription.cancel_at_period_end),
    },
  });
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

  const eventId = event.id;
  const result = await prisma.$transaction(async (tx) => {
    const object = event.data.object as {
      id?: string;
    };
    const recorded = await recordStripeWebhookEvent({
      eventId,
      eventType: event.type,
      sessionId: object.id ?? null,
      client: tx,
    });
    if (!recorded) {
      return { duplicate: true };
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const credits = Number(session.metadata?.credits ?? 0);
      const userId = session.metadata?.userId;

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
            externalId: event.id,
          },
        });
      }

      if (session.mode === "subscription" && session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id
        );
        await upsertSubscriptionFromStripe({
          tx,
          subscription,
        });
      }
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated"
    ) {
      await upsertSubscriptionFromStripe({
        tx,
        subscription: event.data.object as Stripe.Subscription,
      });
    }

    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      await tx.userSubscription.updateMany({
        where: { stripeSubscriptionId: subscription.id },
        data: {
          status: "CANCELED",
          cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
          currentPeriodStart:
            toDateFromUnix(readUnixField(subscription, "current_period_start")) ?? undefined,
          currentPeriodEnd:
            toDateFromUnix(readUnixField(subscription, "current_period_end")) ?? undefined,
        },
      });
    }

    if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice;
      const linePriceId = readNestedString(invoice.lines.data[0], ["price", "id"]);
      const invoiceSubscriptionId = readInvoiceSubscriptionId(invoice);
      const localSubscription = invoiceSubscriptionId
        ? await tx.userSubscription.findUnique({
            where: {
              stripeSubscriptionId: invoiceSubscriptionId,
            },
            select: {
              userId: true,
              plan: {
                select: {
                  code: true,
                },
              },
            },
          })
        : null;

      if (invoiceSubscriptionId && localSubscription) {
        const subscription = await stripe.subscriptions.retrieve(invoiceSubscriptionId);

        if (!subscription.metadata.userId) {
          subscription.metadata.userId = localSubscription.userId;
        }
        if (!subscription.metadata.planId) {
          subscription.metadata.planId = localSubscription.plan.code;
        }
        if (!subscription.items.data[0]?.price?.id && linePriceId) {
          subscription.items.data[0] = {
            ...subscription.items.data[0],
            price: { ...(subscription.items.data[0]?.price ?? {}), id: linePriceId },
          } as Stripe.SubscriptionItem;
        }

        await upsertSubscriptionFromStripe({
          tx,
          subscription,
          resetUsage: true,
        });

        await tx.transaction.create({
          data: {
            userId: localSubscription.userId,
            amount: Number(invoice.amount_paid ?? 0) / 100,
            type: "SUBSCRIPTION_RENEWAL",
            description: "Stripe продление подписки",
            externalId: event.id,
          },
        });
      }
    }

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const invoiceSubscriptionId = readInvoiceSubscriptionId(invoice);
      if (invoiceSubscriptionId) {
        await tx.userSubscription.updateMany({
          where: {
            stripeSubscriptionId: invoiceSubscriptionId,
          },
          data: {
            status: "PAST_DUE",
          },
        });
      }
    }

    return { duplicate: false };
  });

  if (result?.duplicate) {
    console.warn("Stripe webhook duplicate ignored", {
      eventId,
      eventType: event.type,
      sessionId: (event.data.object as { id?: string }).id ?? null,
    });
  }

  return NextResponse.json({ received: true });
}
