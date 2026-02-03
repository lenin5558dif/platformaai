import { beforeEach, describe, expect, test, vi } from "vitest";
import { createFakeQuotaPrisma } from "./helpers/fake-prisma-quota";

const fake = createFakeQuotaPrisma();

vi.mock("@/lib/db", () => ({
  prisma: fake.prisma,
}));

describe("QuotaManager getUtilization", () => {
  beforeEach(async () => {
    fake.reset();
    vi.resetModules();
  });

  test("returns {limit, spent, reserved} for a bucket with no reservations", async () => {
    const { QuotaManager, getAllTimePeriod } = await import("../src/lib/quota-manager");

    const manager = new QuotaManager({ reservationTtlMs: 60_000 });
    const period = getAllTimePeriod();

    // Create bucket via reserve
    const chain = {
      orgId: "org_1",
      subjects: [{ scope: "ORG" as const, subjectId: "org_1" }],
    };

    await manager.reserve({
      chain,
      period,
      amount: 0,
      idempotencyKey: "seed",
      bucketStateBySubject: {
        "ORG:org_1": { limit: 1000, spent: 250 },
      },
    });

    const util = await manager.getUtilization({
      orgId: "org_1",
      scope: "ORG",
      subjectId: "org_1",
      period,
    });

    expect(util).toEqual({ limit: 1000, spent: 250, reserved: 0 });
  });

  test("reserved includes active reservations only", async () => {
    const { QuotaManager, getAllTimePeriod } = await import("../src/lib/quota-manager");

    const manager = new QuotaManager({ reservationTtlMs: 60_000 });
    const period = getAllTimePeriod();
    const chain = {
      orgId: "org_1",
      subjects: [{ scope: "ORG" as const, subjectId: "org_1" }],
    };

    // Seed bucket
    await manager.reserve({
      chain,
      period,
      amount: 0,
      idempotencyKey: "seed",
      bucketStateBySubject: {
        "ORG:org_1": { limit: 1000, spent: 100 },
      },
    });

    // Create active reservation
    const r1 = await manager.reserve({
      chain,
      period,
      amount: 50,
      idempotencyKey: "req_1",
    });

    const util1 = await manager.getUtilization({
      orgId: "org_1",
      scope: "ORG",
      subjectId: "org_1",
      period,
    });

    expect(util1.reserved).toBe(50);

    // Commit the reservation
    await manager.commit({
      orgId: "org_1",
      reservations: r1.reservations,
      finalAmount: 45,
    });

    const util2 = await manager.getUtilization({
      orgId: "org_1",
      scope: "ORG",
      subjectId: "org_1",
      period,
    });

    // After commit, reservation should not count toward reserved
    expect(util2.reserved).toBe(0);
  });

  test("reserved excludes consumed reservations", async () => {
    const { QuotaManager, getAllTimePeriod } = await import("../src/lib/quota-manager");

    const manager = new QuotaManager({ reservationTtlMs: 60_000 });
    const period = getAllTimePeriod();
    const chain = {
      orgId: "org_1",
      subjects: [{ scope: "ORG" as const, subjectId: "org_1" }],
    };

    // Seed bucket and create reservations
    await manager.reserve({
      chain,
      period,
      amount: 0,
      idempotencyKey: "seed",
      bucketStateBySubject: {
        "ORG:org_1": { limit: 1000, spent: 0 },
      },
    });

    const r1 = await manager.reserve({
      chain,
      period,
      amount: 30,
      idempotencyKey: "req_1",
    });

    const r2 = await manager.reserve({
      chain,
      period,
      amount: 20,
      idempotencyKey: "req_2",
    });

    // Verify both reservations are counted
    const utilBefore = await manager.getUtilization({
      orgId: "org_1",
      scope: "ORG",
      subjectId: "org_1",
      period,
    });
    expect(utilBefore.reserved).toBe(50);

    // Commit first reservation
    await manager.commit({
      orgId: "org_1",
      reservations: r1.reservations,
      finalAmount: 30,
    });

    const utilAfterCommit = await manager.getUtilization({
      orgId: "org_1",
      scope: "ORG",
      subjectId: "org_1",
      period,
    });

    // Only second reservation should count
    expect(utilAfterCommit.reserved).toBe(20);

    // Commit second reservation
    await manager.commit({
      orgId: "org_1",
      reservations: r2.reservations,
      finalAmount: 20,
    });

    const utilAfterBoth = await manager.getUtilization({
      orgId: "org_1",
      scope: "ORG",
      subjectId: "org_1",
      period,
    });

    expect(utilAfterBoth.reserved).toBe(0);
  });

  test("reserved excludes released reservations", async () => {
    const { QuotaManager, getAllTimePeriod } = await import("../src/lib/quota-manager");

    const manager = new QuotaManager({ reservationTtlMs: 60_000 });
    const period = getAllTimePeriod();
    const chain = {
      orgId: "org_1",
      subjects: [{ scope: "ORG" as const, subjectId: "org_1" }],
    };

    // Seed bucket
    await manager.reserve({
      chain,
      period,
      amount: 0,
      idempotencyKey: "seed",
      bucketStateBySubject: {
        "ORG:org_1": { limit: 1000, spent: 0 },
      },
    });

    const r1 = await manager.reserve({
      chain,
      period,
      amount: 40,
      idempotencyKey: "req_1",
    });

    const r2 = await manager.reserve({
      chain,
      period,
      amount: 60,
      idempotencyKey: "req_2",
    });

    // Verify both reservations are counted
    const utilBefore = await manager.getUtilization({
      orgId: "org_1",
      scope: "ORG",
      subjectId: "org_1",
      period,
    });
    expect(utilBefore.reserved).toBe(100);

    // Release first reservation
    await manager.release({
      orgId: "org_1",
      reservations: r1.reservations,
    });

    const utilAfterRelease = await manager.getUtilization({
      orgId: "org_1",
      scope: "ORG",
      subjectId: "org_1",
      period,
    });

    // Only second reservation should count
    expect(utilAfterRelease.reserved).toBe(60);

    // Release second reservation
    await manager.release({
      orgId: "org_1",
      reservations: r2.reservations,
    });

    const utilAfterBoth = await manager.getUtilization({
      orgId: "org_1",
      scope: "ORG",
      subjectId: "org_1",
      period,
    });

    expect(utilAfterBoth.reserved).toBe(0);
  });

  test("reserved excludes expired reservations by TTL", async () => {
    const { QuotaManager, getAllTimePeriod } = await import("../src/lib/quota-manager");

    // Use a short TTL for testing
    const ttlMs = 1000;
    const manager = new QuotaManager({ reservationTtlMs: ttlMs });
    const period = getAllTimePeriod();
    const chain = {
      orgId: "org_1",
      subjects: [{ scope: "ORG" as const, subjectId: "org_1" }],
    };

    // Seed bucket
    await manager.reserve({
      chain,
      period,
      amount: 0,
      idempotencyKey: "seed",
      bucketStateBySubject: {
        "ORG:org_1": { limit: 1000, spent: 0 },
      },
    });

    // Create reservation
    await manager.reserve({
      chain,
      period,
      amount: 75,
      idempotencyKey: "req_1",
    });

    // Verify reservation is counted
    const utilBefore = await manager.getUtilization({
      orgId: "org_1",
      scope: "ORG",
      subjectId: "org_1",
      period,
    });
    expect(utilBefore.reserved).toBe(75);

    // Advance time beyond TTL by mocking Date
    const originalDate = Date;
    const futureTime = new originalDate().getTime() + ttlMs + 100;
    global.Date = class extends originalDate {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super(futureTime);
        } else {
          super(...args as [any]);
        }
      }
      static now() {
        return futureTime;
      }
    } as any;

    try {
      const utilAfter = await manager.getUtilization({
        orgId: "org_1",
        scope: "ORG",
        subjectId: "org_1",
        period,
      });

      // Expired reservation should not count
      expect(utilAfter.reserved).toBe(0);
    } finally {
      global.Date = originalDate;
    }
  });

  test("returns zero values for non-existent bucket", async () => {
    const { QuotaManager, getAllTimePeriod } = await import("../src/lib/quota-manager");

    const manager = new QuotaManager({ reservationTtlMs: 60_000 });
    const period = getAllTimePeriod();

    const util = await manager.getUtilization({
      orgId: "org_nonexistent",
      scope: "ORG",
      subjectId: "org_nonexistent",
      period,
    });

    expect(util).toEqual({ limit: 0, spent: 0, reserved: 0 });
  });

  test("reserved sums multiple active reservations", async () => {
    const { QuotaManager, getAllTimePeriod } = await import("../src/lib/quota-manager");

    const manager = new QuotaManager({ reservationTtlMs: 60_000 });
    const period = getAllTimePeriod();
    const chain = {
      orgId: "org_1",
      subjects: [{ scope: "ORG" as const, subjectId: "org_1" }],
    };

    // Seed bucket
    await manager.reserve({
      chain,
      period,
      amount: 0,
      idempotencyKey: "seed",
      bucketStateBySubject: {
        "ORG:org_1": { limit: 1000, spent: 0 },
      },
    });

    // Create multiple reservations
    await manager.reserve({
      chain,
      period,
      amount: 10,
      idempotencyKey: "req_1",
    });

    await manager.reserve({
      chain,
      period,
      amount: 20,
      idempotencyKey: "req_2",
    });

    await manager.reserve({
      chain,
      period,
      amount: 30,
      idempotencyKey: "req_3",
    });

    const util = await manager.getUtilization({
      orgId: "org_1",
      scope: "ORG",
      subjectId: "org_1",
      period,
    });

    expect(util.reserved).toBe(60);
  });

  test("reserved counts only reservations for the specified period", async () => {
    const { QuotaManager, getUtcDayPeriod, getUtcMonthPeriod } = await import("../src/lib/quota-manager");

    const manager = new QuotaManager({ reservationTtlMs: 60_000 });
    const dayPeriod = getUtcDayPeriod(new Date(Date.UTC(2026, 1, 3, 12, 0, 0)));
    const monthPeriod = getUtcMonthPeriod(new Date(Date.UTC(2026, 1, 3, 12, 0, 0)));

    const chain = {
      orgId: "org_1",
      subjects: [{ scope: "ORG" as const, subjectId: "org_1" }],
    };

    // Create buckets for both periods
    await manager.reserve({
      chain,
      period: dayPeriod,
      amount: 0,
      idempotencyKey: "seed_day",
      bucketStateBySubject: {
        "ORG:org_1": { limit: 1000, spent: 0 },
      },
    });

    await manager.reserve({
      chain,
      period: monthPeriod,
      amount: 0,
      idempotencyKey: "seed_month",
      bucketStateBySubject: {
        "ORG:org_1": { limit: 5000, spent: 0 },
      },
    });

    // Create reservations for day period only
    await manager.reserve({
      chain,
      period: dayPeriod,
      amount: 100,
      idempotencyKey: "req_day",
    });

    const dayUtil = await manager.getUtilization({
      orgId: "org_1",
      scope: "ORG",
      subjectId: "org_1",
      period: dayPeriod,
    });

    const monthUtil = await manager.getUtilization({
      orgId: "org_1",
      scope: "ORG",
      subjectId: "org_1",
      period: monthPeriod,
    });

    expect(dayUtil.reserved).toBe(100);
    expect(monthUtil.reserved).toBe(0);
    expect(dayUtil.limit).toBe(1000);
    expect(monthUtil.limit).toBe(5000);
  });
});
