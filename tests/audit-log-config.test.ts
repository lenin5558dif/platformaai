import { describe, expect, test } from "vitest";
import { loadAuditLogOpsConfig } from "@/lib/audit-log-config";

describe("audit log ops config", () => {
  test("rejects retention days < 7 when enabled", () => {
    expect(() =>
      loadAuditLogOpsConfig({
        AUDIT_LOG_RETENTION_ENABLED: "true",
        AUDIT_LOG_RETENTION_DAYS: "6",
      } as any)
    ).toThrow(/RETENTION_DAYS.*>= 7/i);
  });

  test("allows retention days < 7 when retention disabled", () => {
    const cfg = loadAuditLogOpsConfig({
      AUDIT_LOG_RETENTION_ENABLED: "false",
      AUDIT_LOG_RETENTION_DAYS: "6",
    } as any);
    expect(cfg.retention.enabled).toBe(false);
    expect(cfg.retention.days).toBe(6);
  });
});
