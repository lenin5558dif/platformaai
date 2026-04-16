import assert from "node:assert/strict";
import { test } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { recordYookassaWebhookEvent } from "../src/lib/yookassa-webhook";

const duplicateClient = {
  paymentWebhookEvent: {
    createMany: async () => ({ count: 0 }),
  },
} as unknown as PrismaClient;

const firstDeliveryClient = {
  paymentWebhookEvent: {
    createMany: async () => ({ count: 1 }),
  },
} as unknown as PrismaClient;

test("records first payment.succeeded event", async () => {
  const recorded = await recordYookassaWebhookEvent({
    eventId: "payment.succeeded:pay_1",
    eventType: "payment.succeeded",
    paymentId: "pay_1",
    client: firstDeliveryClient,
  });

  assert.equal(recorded, true);
});

test("ignores replayed payment.succeeded event", async () => {
  const recorded = await recordYookassaWebhookEvent({
    eventId: "payment.succeeded:pay_1",
    eventType: "payment.succeeded",
    paymentId: "pay_1",
    client: duplicateClient,
  });

  assert.equal(recorded, false);
});
