import { beforeEach, describe, expect, test, vi } from "vitest";
import { createFakeQuotaPrisma } from "./helpers/fake-prisma-quota";

const fake = createFakeQuotaPrisma();

vi.mock("@/lib/db", () => ({
  prisma: fake.prisma,
}));

describe("QuotaManager idempotency + rollback", () => {
  beforeEach(async () => {
    fake.reset();
    vi.resetModules();
  });

  test("reserve is idempotent while reservation is active", async () => {
    const { QuotaManager, getAllTimePeriod } = await import("../src/lib/quota-manager");

    const manager = new QuotaManager({ reservationTtlMs: 60_000 });
    const period = getAllTimePeriod();
    const chain = {
      orgId: "org_1",
      subjects: [{ scope: "ORG" as const, subjectId: "org_1" }],
    };

    const r1 = await manager.reserve({
      chain,
      period,
      amount: 5,
      idempotencyKey: "req_1",
      bucketStateBySubject: {
        "ORG:org_1": { limit: 100, spent: 0 },
      },
    });

    const r2 = await manager.reserve({
      chain,
      period,
      amount: 5,
      idempotencyKey: "req_1",
      bucketStateBySubject: {
        "ORG:org_1": { limit: 100, spent: 0 },
      },
    });

    expect(r1.reservations).toHaveLength(1);
    expect(r2.reservations).toHaveLength(1);
    expect(r2.reservations[0].id).toEqual(r1.reservations[0].id);
    expect(r2.reservations[0].requestId).toEqual(r1.reservations[0].requestId);

    const snap = fake.snapshot();
    expect(snap.reservations).toHaveLength(1);
  });

  test("commit is idempotent (double commit does not throw or double-spend)", async () => {
    const { QuotaManager, getAllTimePeriod } = await import("../src/lib/quota-manager");

    const manager = new QuotaManager({ reservationTtlMs: 60_000 });
    const period = getAllTimePeriod();
    const chain = {
      orgId: "org_1",
      subjects: [{ scope: "ORG" as const, subjectId: "org_1" }],
    };

    const reserved = await manager.reserve({
      chain,
      period,
      amount: 10,
      idempotencyKey: "req_commit",
      bucketStateBySubject: {
        "ORG:org_1": { limit: 100, spent: 0 },
      },
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await manager.commit({
      orgId: "org_1",
      reservations: reserved.reservations,
      finalAmount: 7,
    });

    await manager.commit({
      orgId: "org_1",
      reservations: reserved.reservations,
      finalAmount: 7,
    });

    expect(warnSpy).not.toHaveBeenCalled();

    const snap = fake.snapshot();
    expect(snap.reservations).toHaveLength(1);
    expect(snap.reservations[0].consumedAt).not.toBeNull();
    expect(snap.reservations[0].releasedAt).toBeNull();
    expect(snap.reservations[0].amount).toBe(7);
  });

  test("commit emits QUOTA_OVERAGE warning when finalAmount exceeds reserved", async () => {
    const { QuotaManager, getAllTimePeriod } = await import("../src/lib/quota-manager");

    const manager = new QuotaManager({ reservationTtlMs: 60_000 });
    const period = getAllTimePeriod();
    const chain = {
      orgId: "org_1",
      subjects: [{ scope: "ORG" as const, subjectId: "org_1" }],
    };

    const reserved = await manager.reserve({
      chain,
      period,
      amount: 3,
      idempotencyKey: "req_overage",
      bucketStateBySubject: {
        "ORG:org_1": { limit: 100, spent: 0 },
      },
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await manager.commit({
      orgId: "org_1",
      reservations: reserved.reservations,
      finalAmount: 5,
    });

    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0]?.[0] ?? "")).toContain("QUOTA_OVERAGE");
  });

  test("release is idempotent (double release does not throw)", async () => {
    const { QuotaManager, getAllTimePeriod } = await import("../src/lib/quota-manager");

    const manager = new QuotaManager({ reservationTtlMs: 60_000 });
    const period = getAllTimePeriod();
    const chain = {
      orgId: "org_1",
      subjects: [{ scope: "ORG" as const, subjectId: "org_1" }],
    };

    const reserved = await manager.reserve({
      chain,
      period,
      amount: 10,
      idempotencyKey: "req_release",
      bucketStateBySubject: {
        "ORG:org_1": { limit: 100, spent: 0 },
      },
    });

    await manager.release({ orgId: "org_1", reservations: reserved.reservations });
    await manager.release({ orgId: "org_1", reservations: reserved.reservations });

    const snap = fake.snapshot();
    expect(snap.reservations).toHaveLength(1);
    expect(snap.reservations[0].releasedAt).not.toBeNull();
    expect(snap.reservations[0].consumedAt).toBeNull();
  });

  test("multi-scope reserve is all-or-nothing (rolls back on partial success)", async () => {
    const { QuotaManager, buildQuotaChain, getAllTimePeriod } = await import("../src/lib/quota-manager");

    const manager = new QuotaManager({ reservationTtlMs: 60_000 });
    const period = getAllTimePeriod();
    const chain = buildQuotaChain({ orgId: "org_1", userId: "user_1" });

    await expect(
      manager.reserve({
        chain,
        period,
        amount: 10,
        idempotencyKey: "req_rollback",
        bucketStateBySubject: {
          "USER:user_1": { limit: 100, spent: 0 },
          "ORG:org_1": { limit: 5, spent: 0 },
        },
      }),
    ).rejects.toThrow("QUOTA_LIMIT_EXCEEDED");

    const snap = fake.snapshot();
    expect(snap.reservations).toHaveLength(0);
    expect(snap.buckets).toHaveLength(0);
  });
});
