import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

type YookassaWebhookClient = PrismaClient | Prisma.TransactionClient;

type PaymentWebhookEventStore = {
  paymentWebhookEvent: {
    createMany: (args: {
      data: Array<{
        provider: string;
        eventId: string;
        paymentId: string | null;
        eventType: string;
      }>;
      skipDuplicates: boolean;
    }) => Promise<{ count: number }>;
  };
};

export type YookassaPaymentSucceededNotification = {
  event: string;
  object: {
    id?: string;
    status?: string;
    metadata?: Record<string, string>;
  };
};

type RecordYookassaWebhookEventParams = {
  eventId: string;
  eventType: string;
  paymentId?: string | null;
  client?: YookassaWebhookClient;
};

export async function recordYookassaWebhookEvent({
  eventId,
  eventType,
  paymentId,
  client = prisma,
}: RecordYookassaWebhookEventParams): Promise<boolean> {
  const store = client as unknown as PaymentWebhookEventStore;
  const result = await store.paymentWebhookEvent.createMany({
    data: [
      {
        provider: "yookassa",
        eventId,
        paymentId: paymentId ?? null,
        eventType,
      },
    ],
    skipDuplicates: true,
  });

  return result.count > 0;
}

export function parseYookassaSucceededNotification(
  payload: unknown
): YookassaPaymentSucceededNotification {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid YooKassa webhook payload");
  }

  const event = (payload as { event?: unknown }).event;
  const object = (payload as { object?: unknown }).object;

  if (event !== "payment.succeeded") {
    throw new Error("Unsupported YooKassa webhook event");
  }

  if (!object || typeof object !== "object") {
    throw new Error("Invalid YooKassa webhook object");
  }

  return {
    event,
    object: object as YookassaPaymentSucceededNotification["object"],
  };
}

export function getYookassaWebhookEventId(
  notification: YookassaPaymentSucceededNotification
) {
  return `${notification.event}:${notification.object.id ?? "unknown"}`;
}
