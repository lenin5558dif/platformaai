import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  createMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    stripeWebhookEvent: {
      createMany: state.createMany,
    },
  },
}));

describe("stripe webhook helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("uses the default client and normalizes missing session ids", async () => {
    state.createMany.mockResolvedValueOnce({ count: 1 });
    const { recordStripeWebhookEvent } = await import("@/lib/stripe-webhook");

    const recorded = await recordStripeWebhookEvent({
      eventId: "evt_1",
      eventType: "checkout.session.completed",
    });

    expect(recorded).toBe(true);
    expect(state.createMany).toHaveBeenCalledWith({
      data: [
        {
          eventId: "evt_1",
          eventType: "checkout.session.completed",
          sessionId: null,
        },
      ],
      skipDuplicates: true,
    });
  });
});
