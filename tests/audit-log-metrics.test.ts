import { beforeEach, describe, expect, test, vi } from "vitest";
import { AuditAction } from "@prisma/client";
import { metricsRegistry } from "@/lib/metrics";

const prisma = {
  auditLog: {
    create: vi.fn(async () => ({ id: "a" })),
  },
} as any;

vi.mock("@/lib/db", () => ({ prisma }));

describe("audit log metrics", () => {
  beforeEach(() => {
    metricsRegistry.resetForTests();
    prisma.auditLog.create.mockClear();
    process.env.AUDIT_LOG_ENABLED = "1";
    process.env.AUDIT_LOG_METRICS_ENABLED = "1";
    process.env.AUDIT_LOG_RETENTION_ENABLED = "0";
    process.env.AUDIT_LOG_METRICS_ACTION_TYPES = "CREATE";
  });

  test("audit_log_entries_total increments with labels", async () => {
    const { logAudit } = await import("@/lib/audit");
    await logAudit({
      action: AuditAction.USER_INVITED,
      targetType: "User",
      targetId: "u1",
    });

    const { __metrics } = await import("@/lib/audit-metrics");
    const value = metricsRegistry.getCounterValue(__metrics.entriesTotal as any, {
      action_type: "CREATE",
      entity_type: "USER",
    });
    expect(value).toBe(1);
  });

  test("unknown/invalid entity_type is normalized to UNKNOWN", async () => {
    const { recordAuditEntry, __metrics } = await import("@/lib/audit-metrics");
    recordAuditEntry({ action: AuditAction.USER_INVITED, targetType: "User Name" });
    const value = metricsRegistry.getCounterValue(__metrics.entriesTotal as any, {
      action_type: "CREATE",
      entity_type: "UNKNOWN",
    });
    expect(value).toBe(1);
  });

  test("invalid action types are handled gracefully", async () => {
    const { recordAuditEntry, __metrics } = await import("@/lib/audit-metrics");
    recordAuditEntry({ action: "TOTALLY_NEW_ACTION" as any, targetType: "User" });
    const value = metricsRegistry.getCounterValue(__metrics.entriesTotal as any, {
      action_type: "OTHER",
      entity_type: "USER",
    });
    expect(value).toBe(1);
  });

  test("purge metrics are emitted", async () => {
    const { recordPurgeMetrics, __metrics } = await import("@/lib/audit-metrics");
    recordPurgeMetrics({
      deleted: 3,
      durationSeconds: 1.25,
      errors: 0,
      nowSeconds: 100,
      oldestRetainedAgeSeconds: 42,
    });

    const deleted = metricsRegistry.getCounterValue(__metrics.purgeRecordsTotal as any, undefined);
    expect(deleted).toBe(3);

    const histCount = metricsRegistry.getHistogramCount(__metrics.purgeDuration as any, undefined);
    expect(histCount).toBe(1);

    const last = metricsRegistry.getGaugeValue(__metrics.purgeLastSuccessTs as any, undefined);
    expect(last).toBe(100);

    const age = metricsRegistry.getGaugeValue(__metrics.oldestRetainedAge as any, undefined);
    expect(age).toBe(42);
  });

  test("audit_log_errors_total increments on write failure", async () => {
    prisma.auditLog.create.mockImplementationOnce(async () => {
      throw new Error("DB_DOWN");
    });

    const { logAudit } = await import("@/lib/audit");
    await logAudit({
      action: AuditAction.USER_UPDATED,
      targetType: "User",
      targetId: "u1",
    });

    const { __metrics } = await import("@/lib/audit-metrics");
    const value = metricsRegistry.getCounterValue(__metrics.auditErrorsTotal as any, {
      error_type: "DB",
    });
    expect(value).toBe(1);
  });
});
