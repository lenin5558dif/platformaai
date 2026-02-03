import { describe, expect, test } from "vitest";
import { purgeAuditLogs } from "@/lib/audit-log-retention";

function makePrisma(rows: { id: string; createdAt: Date }[]) {
  const data = [...rows];

  const prisma = {
    auditLog: {
      findMany: async (args: any) => {
        const cutoff = args.where.createdAt.lte as Date;
        let filtered = data.filter((r) => r.createdAt <= cutoff);

        // Support cursor pagination for dry-run mode.
        const ors = Array.isArray(args.where.OR) ? args.where.OR : null;
        if (ors) {
          let cursorCreatedAt: Date | null = null;
          let cursorId: string | null = null;

          for (const cond of ors) {
            if (cond?.createdAt?.gt) {
              cursorCreatedAt = cond.createdAt.gt as Date;
            }
            if (cond?.createdAt instanceof Date && cond?.id?.gt) {
              cursorCreatedAt = cond.createdAt as Date;
              cursorId = cond.id.gt as string;
            }
          }

          if (cursorCreatedAt) {
            filtered = filtered.filter((r) => {
              if (r.createdAt.getTime() > cursorCreatedAt!.getTime()) return true;
              if (r.createdAt.getTime() < cursorCreatedAt!.getTime()) return false;
              if (!cursorId) return false;
              return r.id > cursorId;
            });
          }
        }

        filtered = filtered
          .sort((a, b) => {
            const dt = a.createdAt.getTime() - b.createdAt.getTime();
            if (dt !== 0) return dt;
            return a.id.localeCompare(b.id);
          })
          .slice(0, args.take);
        return filtered.map((r) => ({ id: r.id, createdAt: r.createdAt }));
      },
      deleteMany: async (args: any) => {
        const ids = new Set(args.where.id.in as string[]);
        const before = data.length;
        for (let i = data.length - 1; i >= 0; i--) {
          if (ids.has(data[i].id)) data.splice(i, 1);
        }
        return { count: before - data.length };
      },
      findFirst: async () => {
        if (data.length === 0) return null;
        const oldest = data.reduce((min, r) =>
          r.createdAt < min.createdAt ? r : min
        );
        return { createdAt: oldest.createdAt };
      },
    },
  } as any;

  return { prisma, data };
}

describe("audit log retention", () => {
  test("inclusive cutoff: entries exactly at boundary are purged", async () => {
    const now = new Date("2026-02-03T12:00:00.000Z");
    const days = 90;
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const { prisma, data } = makePrisma([
      { id: "at_cutoff", createdAt: cutoff },
      { id: "newer", createdAt: new Date(cutoff.getTime() + 1) },
    ]);

    const res = await purgeAuditLogs({
      prisma,
      now,
      config: {
        enabled: true,
        days,
        batchSize: 1000,
        batchDelayMs: 0,
        maxRuntimeMinutes: 5,
        dryRun: false,
      },
      sleep: async () => undefined,
    });

    expect(res.deleted).toBe(1);
    expect(data.map((r) => r.id)).toEqual(["newer"]);
  });

  test("records newer than retention are preserved", async () => {
    const now = new Date("2026-02-03T12:00:00.000Z");
    const days = 30;
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const { prisma, data } = makePrisma([
      { id: "newer1", createdAt: new Date(cutoff.getTime() + 1000) },
      { id: "newer2", createdAt: new Date(now.getTime() - 1000) },
    ]);

    const res = await purgeAuditLogs({
      prisma,
      now,
      config: {
        enabled: true,
        days,
        batchSize: 100,
        batchDelayMs: 0,
        maxRuntimeMinutes: 5,
        dryRun: false,
      },
      sleep: async () => undefined,
    });

    expect(res.deleted).toBe(0);
    expect(data.length).toBe(2);
  });

  test("batch size limits are respected", async () => {
    const now = new Date("2026-02-03T12:00:00.000Z");
    const old = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000);
    const { prisma, data } = makePrisma([
      { id: "a", createdAt: old },
      { id: "b", createdAt: old },
      { id: "c", createdAt: old },
    ]);

    const res = await purgeAuditLogs({
      prisma,
      now,
      config: {
        enabled: true,
        days: 90,
        batchSize: 2,
        batchDelayMs: 0,
        maxRuntimeMinutes: 5,
        dryRun: false,
      },
      sleep: async () => undefined,
    });

    expect(res.batches).toBe(2);
    expect(res.deleted).toBe(3);
    expect(data.length).toBe(0);
  });

  test("dry-run does not delete records", async () => {
    const now = new Date("2026-02-03T12:00:00.000Z");
    const old = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000);
    const { prisma, data } = makePrisma([{ id: "a", createdAt: old }]);

    const res = await purgeAuditLogs({
      prisma,
      now,
      config: {
        enabled: true,
        days: 90,
        batchSize: 1000,
        batchDelayMs: 0,
        maxRuntimeMinutes: 5,
        dryRun: true,
      },
      sleep: async () => undefined,
    });

    expect(res.deleted).toBe(1);
    expect(data.length).toBe(1);
  });

  test("max runtime protection stops job", async () => {
    const now = new Date("2026-02-03T12:00:00.000Z");
    const old = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000);
    const { prisma } = makePrisma(
      Array.from({ length: 100 }, (_, i) => ({ id: String(i), createdAt: old }))
    );

    let t = 0;
    const res = await purgeAuditLogs({
      prisma,
      now,
      nowMs: () => t,
      sleep: async () => {
        t += 60 * 1000;
      },
      config: {
        enabled: true,
        days: 90,
        batchSize: 1,
        batchDelayMs: 1,
        maxRuntimeMinutes: 1,
        dryRun: false,
      },
    });

    expect(res.stoppedReason).toBe("max_runtime");
  });

  test("idempotency: second run deletes nothing", async () => {
    const now = new Date("2026-02-03T12:00:00.000Z");
    const old = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000);
    const { prisma } = makePrisma([{ id: "a", createdAt: old }]);

    const cfg = {
      enabled: true,
      days: 90,
      batchSize: 1000,
      batchDelayMs: 0,
      maxRuntimeMinutes: 5,
      dryRun: false,
    };

    const first = await purgeAuditLogs({ prisma, now, config: cfg, sleep: async () => undefined });
    const second = await purgeAuditLogs({ prisma, now, config: cfg, sleep: async () => undefined });

    expect(first.deleted).toBe(1);
    expect(second.deleted).toBe(0);
  });
});
