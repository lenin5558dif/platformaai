import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { recordStripeWebhookEvent } from "../src/lib/stripe-webhook";

const duplicateClient = {
  stripeWebhookEvent: {
    createMany: async () => ({ count: 0 }),
  },
} as unknown as PrismaClient;

const firstDeliveryClient = {
  stripeWebhookEvent: {
    createMany: async () => ({ count: 1 }),
  },
} as unknown as PrismaClient;

test("records first checkout.session.completed event", async () => {
  const recorded = await recordStripeWebhookEvent({
    eventId: "evt_1",
    eventType: "checkout.session.completed",
    sessionId: "cs_1",
    client: firstDeliveryClient,
  });

  assert.equal(recorded, true);
});

test("ignores replayed checkout.session.completed event", async () => {
  const recorded = await recordStripeWebhookEvent({
    eventId: "evt_1",
    eventType: "checkout.session.completed",
    sessionId: "cs_1",
    client: duplicateClient,
  });

  assert.equal(recorded, false);
});
