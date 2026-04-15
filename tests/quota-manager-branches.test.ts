import { beforeEach, describe, expect, test, vi } from "vitest";
import { createFakeQuotaPrisma } from "./helpers/fake-prisma-quota";

const fake = createFakeQuotaPrisma();

vi.mock("@/lib/db", () => ({
  prisma: fake.prisma,
}));

describe("QuotaManager branch coverage", () => {
  beforeEach(async () => {
    fake.reset();
    vi.resetModules();
  });

  test("parseReservationRequestId and periodFromKey reject malformed inputs", async () => {
    const { parseReservationRequestId, periodFromKey } = await import("../src/lib/quota-manager");

    expect(parseReservationRequestId("bad")).toBeNull();
    expect(parseReservationRequestId("req||ORG|org_1")).toBeNull();

    expect(() => periodFromKey("invalid")).toThrow("INVALID_PERIOD_KEY");
    expect(() => periodFromKey("day:not-a-date")).toThrow("INVALID_PERIOD_KEY");
    expect(() => periodFromKey("quarter:2026-02-03T00:00:00.000Z")).toThrow("INVALID_PERIOD_KEY");
  });

  test("evaluate allows zero-limit buckets and blocks over-limit requests", async () => {
    const { QuotaManager, getAllTimePeriod } = await import("../src/lib/quota-manager");

    const manager = new QuotaManager({ reservationTtlMs: 60_000 });
    const period = getAllTimePeriod();
    const orgChain = {
      orgId: "org_1",
      subjects: [{ scope: "ORG" as const, subjectId: "org_1" }],
    };

    await manager.reserve({
      chain: orgChain,
      period,
      amount: 0,
      idempotencyKey: "seed",
      bucketStateBySubject: {
        "ORG:org_1": { limit: 0, spent: 12 },
      },
    });

    const unenforced = await manager.evaluate({
      orgId: "org_1",
      scope: "ORG",
      subjectId: "org_1",
      period,
      amount: 999,
    });

    expect(unenforced.allowed).toBe(true);
    if (unenforced.allowed) {
      expect(unenforced.remaining).toBe(Infinity);
      expect(unenforced.utilization).toEqual({ limit: 0, spent: 12, reserved: 0 });
    }

    const userChain = {
      orgId: "org_1",
      subjects: [{ scope: "USER" as const, subjectId: "user_1" }],
    };

    await manager.reserve({
      chain: userChain,
      period,
      amount: 0,
      idempotencyKey: "seed_limited",
      bucketStateBySubject: {
        "USER:user_1": { limit: 100, spent: 70 },
      },
    });

    await manager.reserve({
      chain: userChain,
      period,
      amount: 20,
      idempotencyKey: "active",
    });

    const blocked = await manager.evaluate({
      orgId: "org_1",
      scope: "USER",
      subjectId: "user_1",
      period,
      amount: 11,
    });

    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.reason).toBe("LIMIT_EXCEEDED");
      expect(blocked.utilization).toEqual({ limit: 100, spent: 70, reserved: 20 });
    }
  });

  test("reserve rejects org mismatch when bucket already exists for another org", async () => {
    const { QuotaManager, getAllTimePeriod } = await import("../src/lib/quota-manager");

    const manager = new QuotaManager({ reservationTtlMs: 60_000 });
    const period = getAllTimePeriod();
    const seedChain = {
      orgId: "org_1",
      subjects: [{ scope: "ORG" as const, subjectId: "org_1" }],
    };

    await manager.reserve({
      chain: seedChain,
      period,
      amount: 0,
      idempotencyKey: "seed",
      bucketStateBySubject: {
        "ORG:org_1": { limit: 10, spent: 0 },
      },
    });

    await expect(
      manager.reserve({
        chain: {
          orgId: "org_2",
          subjects: [{ scope: "ORG" as const, subjectId: "org_1" }],
        },
        period,
        amount: 1,
        idempotencyKey: "mismatch",
      }),
    ).rejects.toThrow("QUOTA_BUCKET_ORG_MISMATCH");
  });

  test("commit rejects invalid request ids and org mismatch", async () => {
    const { QuotaManager, getAllTimePeriod, buildReservationRequestId } = await import("../src/lib/quota-manager");

    const manager = new QuotaManager({ reservationTtlMs: 60_000 });
    const period = getAllTimePeriod();
    const chain = {
      orgId: "org_1",
      subjects: [{ scope: "ORG" as const, subjectId: "org_1" }],
    };

    const reserved = await manager.reserve({
      chain,
      period,
      amount: 5,
      idempotencyKey: "req_1",
      bucketStateBySubject: {
        "ORG:org_1": { limit: 100, spent: 0 },
      },
    });

    await expect(
      manager.commit({
        orgId: "org_1",
        reservations: [{ ...reserved.reservations[0], requestId: "broken" }],
        finalAmount: 5,
      }),
    ).rejects.toThrow("INVALID_RESERVATION_REQUEST_ID");

    await expect(
      manager.commit({
        orgId: "org_1",
        reservations: [
          {
            id: "missing",
            scope: "ORG",
            subjectId: "org_1",
            requestId: buildReservationRequestId({
              idempotencyKey: "ghost",
              periodKey: period.key,
              scope: "ORG",
              subjectId: "org_1",
            }),
          },
        ],
        finalAmount: 5,
      }),
    ).resolves.toBeUndefined();

    await expect(
      manager.commit({
        orgId: "org_2",
        reservations: reserved.reservations,
        finalAmount: 5,
      }),
    ).rejects.toThrow("RESERVATION_ORG_MISMATCH");
  });

  test("release ignores missing and already consumed reservations", async () => {
    const { QuotaManager, getAllTimePeriod, buildReservationRequestId } = await import("../src/lib/quota-manager");

    const manager = new QuotaManager({ reservationTtlMs: 60_000 });
    const period = getAllTimePeriod();
    const chain = {
      orgId: "org_1",
      subjects: [{ scope: "ORG" as const, subjectId: "org_1" }],
    };

    const reserved = await manager.reserve({
      chain,
      period,
      amount: 5,
      idempotencyKey: "req_release_then_commit",
      bucketStateBySubject: {
        "ORG:org_1": { limit: 100, spent: 0 },
      },
    });

    await manager.release({
      orgId: "org_1",
      reservations: [
        {
          id: "missing",
          scope: "ORG",
          subjectId: "org_1",
          requestId: buildReservationRequestId({
            idempotencyKey: "ghost",
            periodKey: period.key,
            scope: "ORG",
            subjectId: "org_1",
          }),
        },
      ],
    });

    await manager.commit({
      orgId: "org_1",
      reservations: reserved.reservations,
      finalAmount: 5,
    });

    await manager.release({
      orgId: "org_1",
      reservations: reserved.reservations,
    });

    const snap = fake.snapshot();
    expect(snap.reservations[0]?.consumedAt).not.toBeNull();
    expect(snap.reservations[0]?.releasedAt).toBeNull();
  });

  test("commit rejects reservations that were already released", async () => {
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
      amount: 7,
      idempotencyKey: "req_release_invalid",
      bucketStateBySubject: {
        "ORG:org_1": { limit: 100, spent: 0 },
      },
    });

    await manager.release({
      orgId: "org_1",
      reservations: reserved.reservations,
    });

    await expect(
      manager.commit({
        orgId: "org_1",
        reservations: reserved.reservations,
        finalAmount: 5,
      }),
    ).rejects.toThrow("RESERVATION_ALREADY_RELEASED");
  });

  test("release ignores malformed request ids", async () => {
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
      amount: 7,
      idempotencyKey: "req_release_invalid",
      bucketStateBySubject: {
        "ORG:org_1": { limit: 100, spent: 0 },
      },
    });

    await manager.release({
      orgId: "org_1",
      reservations: [{ ...reserved.reservations[0], requestId: "invalid" }],
    });

    const snap = fake.snapshot();
    expect(snap.reservations[0]?.releasedAt).toBeNull();
    expect(snap.reservations[0]?.consumedAt).toBeNull();
  });
});
