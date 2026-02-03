import { beforeEach, describe, expect, test, vi } from "vitest";
import { createFakeQuotaPrisma } from "./helpers/fake-prisma-quota";

const fake = createFakeQuotaPrisma();

vi.mock("@/lib/db", () => ({
  prisma: fake.prisma,
}));

describe("QuotaManager concurrency", () => {
  beforeEach(async () => {
    fake.reset();
    vi.resetModules();
  });

  test("parallel reserves do not overspend the bucket limit", async () => {
    const { QuotaManager, getAllTimePeriod } = await import("../src/lib/quota-manager");

    const manager = new QuotaManager({ reservationTtlMs: 60_000 });
    const period = getAllTimePeriod();
    const chain = {
      orgId: "org_1",
      subjects: [{ scope: "ORG" as const, subjectId: "org_1" }],
    };

    const [a, b] = await Promise.allSettled([
      manager.reserve({
        chain,
        period,
        amount: 7,
        idempotencyKey: "req_a",
        bucketStateBySubject: {
          "ORG:org_1": { limit: 10, spent: 0 },
        },
      }),
      manager.reserve({
        chain,
        period,
        amount: 7,
        idempotencyKey: "req_b",
        bucketStateBySubject: {
          "ORG:org_1": { limit: 10, spent: 0 },
        },
      }),
    ]);

    const fulfilled = [a, b].filter((r) => r.status === "fulfilled");
    const rejected = [a, b].filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason?.message).toBe("QUOTA_LIMIT_EXCEEDED");

    const snap = fake.snapshot();
    const active = snap.reservations.filter((r) => !r.consumedAt && !r.releasedAt);
    const total = active.reduce((acc, r) => acc + r.amount, 0);
    expect(active).toHaveLength(1);
    expect(total).toBe(7);
  });

  test("parallel reserves up to the limit are allowed", async () => {
    const { QuotaManager, getAllTimePeriod } = await import("../src/lib/quota-manager");

    const manager = new QuotaManager({ reservationTtlMs: 60_000 });
    const period = getAllTimePeriod();
    const chain = {
      orgId: "org_1",
      subjects: [{ scope: "ORG" as const, subjectId: "org_1" }],
    };

    await Promise.all([
      manager.reserve({
        chain,
        period,
        amount: 5,
        idempotencyKey: "req_1",
        bucketStateBySubject: {
          "ORG:org_1": { limit: 10, spent: 0 },
        },
      }),
      manager.reserve({
        chain,
        period,
        amount: 5,
        idempotencyKey: "req_2",
        bucketStateBySubject: {
          "ORG:org_1": { limit: 10, spent: 0 },
        },
      }),
    ]);

    const snap = fake.snapshot();
    const active = snap.reservations.filter((r) => !r.consumedAt && !r.releasedAt);
    const total = active.reduce((acc, r) => acc + r.amount, 0);
    expect(active).toHaveLength(2);
    expect(total).toBe(10);
  });
});
