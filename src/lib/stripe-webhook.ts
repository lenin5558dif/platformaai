import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

type StripeWebhookClient = PrismaClient | Prisma.TransactionClient;

type StripeWebhookEventStore = {
  stripeWebhookEvent: {
    createMany: (args: {
      data: Array<{
        eventId: string;
        eventType: string;
        sessionId: string | null;
      }>;
      skipDuplicates: boolean;
    }) => Promise<{ count: number }>;
  };
};

type RecordStripeWebhookEventParams = {
  eventId: string;
  eventType: string;
  sessionId?: string | null;
  client?: StripeWebhookClient;
};

export async function recordStripeWebhookEvent({
  eventId,
  eventType,
  sessionId,
  client = prisma,
}: RecordStripeWebhookEventParams): Promise<boolean> {
  const store = client as unknown as StripeWebhookEventStore;
  const result = await store.stripeWebhookEvent.createMany({
    data: [
      {
        eventId,
        eventType,
        sessionId: sessionId ?? null,
      },
    ],
    skipDuplicates: true,
  });

  return result.count > 0;
}
