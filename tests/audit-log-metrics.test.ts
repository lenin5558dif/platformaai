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

  test("auditActionType maps all known action families", async () => {
    const { auditActionType } = await import("@/lib/audit-metrics");

    expect(auditActionType("USER_INVITED" as AuditAction)).toBe("CREATE");
    expect(auditActionType("SCIM_TOKEN_CREATED" as AuditAction)).toBe("CREATE");
    expect(auditActionType("ORG_UPDATED" as AuditAction)).toBe("UPDATE");
    expect(auditActionType("COST_CENTER_ASSIGNED" as AuditAction)).toBe("UPDATE");
    expect(auditActionType("COST_CENTER_DELETED" as AuditAction)).toBe("DELETE");
    expect(auditActionType("USER_DISABLED" as AuditAction)).toBe("DELETE");
    expect(auditActionType("TELEGRAM_LINKED" as AuditAction)).toBe("AUTH");
    expect(auditActionType("ORG_INVITE_ACCEPT_RATE_LIMITED" as AuditAction)).toBe("AUTH");
    expect(auditActionType("POLICY_BLOCKED" as AuditAction)).toBe("POLICY");
    expect(auditActionType("BILLING_REFILL" as AuditAction)).toBe("BILLING");
    expect(auditActionType("SOMETHING_NEW" as AuditAction)).toBe("OTHER");
  });

  test("audit metrics sanitize labels, honor whitelists, and handle purge counters", async () => {
    process.env.AUDIT_LOG_METRICS_ACTION_TYPES = "CREATE,UPDATE";
    const { recordAuditEntry, recordAuditError, recordPurgeMetrics, __metrics } = await import(
      "@/lib/audit-metrics"
    );

    recordAuditEntry({
      action: AuditAction.USER_INVITED,
      targetType: "user",
    });
    recordAuditEntry({
      action: AuditAction.TELEGRAM_LINKED,
      targetType: "user",
    });

    expect(
      metricsRegistry.getCounterValue(__metrics.entriesTotal as any, {
        action_type: "CREATE",
        entity_type: "USER",
      })
    ).toBe(1);

    expect(
      metricsRegistry.getCounterValue(__metrics.entriesTotal as any, {
        action_type: "OTHER",
        entity_type: "USER",
      })
    ).toBe(1);

    recordAuditError("  bad-type  ");
    recordAuditError("x".repeat(40));

    expect(
      metricsRegistry.getCounterValue(__metrics.auditErrorsTotal as any, {
        error_type: "UNKNOWN",
      })
    ).toBe(2);

    recordPurgeMetrics({
      deleted: 0,
      durationSeconds: 2,
      errors: 1,
    });

    expect(metricsRegistry.getCounterValue(__metrics.purgeRecordsTotal as any, undefined)).toBe(0);
    expect(metricsRegistry.getCounterValue(__metrics.purgeErrorsTotal as any, undefined)).toBe(1);
    expect(metricsRegistry.getHistogramCount(__metrics.purgeDuration as any, undefined)).toBe(1);
    expect(metricsRegistry.getGaugeValue(__metrics.purgeLastSuccessTs as any, undefined)).toBe(0);
    expect(metricsRegistry.getGaugeValue(__metrics.oldestRetainedAge as any, undefined)).toBe(0);
  });

  test("audit metrics stay quiet when disabled", async () => {
    process.env.AUDIT_LOG_METRICS_ENABLED = "0";
    const { recordAuditEntry, recordAuditError, recordPurgeMetrics, __metrics } = await import(
      "@/lib/audit-metrics"
    );

    recordAuditEntry({
      action: AuditAction.USER_INVITED,
      targetType: "USER",
    });
    recordAuditError("DB");
    recordPurgeMetrics({
      deleted: 5,
      durationSeconds: 1,
      errors: 2,
      nowSeconds: 123,
      oldestRetainedAgeSeconds: 456,
    });

    expect(metricsRegistry.getCounterValue(__metrics.entriesTotal as any, {
      action_type: "CREATE",
      entity_type: "USER",
    })).toBe(0);
    expect(metricsRegistry.getCounterValue(__metrics.auditErrorsTotal as any, {
      error_type: "DB",
    })).toBe(0);
    expect(metricsRegistry.getCounterValue(__metrics.purgeRecordsTotal as any, undefined)).toBe(0);
    expect(metricsRegistry.getCounterValue(__metrics.purgeErrorsTotal as any, undefined)).toBe(0);
    expect(metricsRegistry.getHistogramCount(__metrics.purgeDuration as any, undefined)).toBe(0);
  });

  test("logAudit exits early when audit logging is disabled", async () => {
    process.env.AUDIT_LOG_ENABLED = "0";

    const { logAudit } = await import("@/lib/audit");
    await logAudit({
      action: AuditAction.USER_UPDATED,
    });

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
