import { z } from "zod";

function parseBool(value: string | undefined, defaultValue: boolean) {
  if (value === undefined) return defaultValue;
  if (value === "1" || value.toLowerCase() === "true") return true;
  if (value === "0" || value.toLowerCase() === "false") return false;
  return defaultValue;
}

function parseNumber(value: string | undefined, defaultValue: number) {
  if (value === undefined || value.trim() === "") return defaultValue;
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

function parseCsv(value: string | undefined) {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const auditLogRetentionSchema = z
  .object({
    enabled: z.boolean(),
    days: z.number().int(),
    batchSize: z.number().int().positive(),
    batchDelayMs: z.number().int().nonnegative(),
    maxRuntimeMinutes: z.number().int().positive(),
    dryRun: z.boolean(),
  })
  .superRefine((val, ctx) => {
    if (val.enabled && val.days < 7) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "AUDIT_LOG_RETENTION_DAYS must be >= 7 when retention is enabled",
        path: ["days"],
      });
    }
  });

const auditLogMetricsSchema = z.object({
  enabled: z.boolean(),
  actionTypesWhitelist: z.array(z.string()).default([]),
});

export type AuditLogRetentionConfig = z.infer<typeof auditLogRetentionSchema>;
export type AuditLogMetricsConfig = z.infer<typeof auditLogMetricsSchema>;

export type AuditLogOpsConfig = {
  retention: AuditLogRetentionConfig;
  metrics: AuditLogMetricsConfig;
};

export function loadAuditLogOpsConfig(env = process.env): AuditLogOpsConfig {
  const retention = {
    enabled: parseBool(env.AUDIT_LOG_RETENTION_ENABLED, false),
    days: parseNumber(env.AUDIT_LOG_RETENTION_DAYS, 90),
    batchSize: parseNumber(env.AUDIT_LOG_RETENTION_BATCH_SIZE, 1000),
    batchDelayMs: parseNumber(env.AUDIT_LOG_RETENTION_BATCH_DELAY_MS, 100),
    maxRuntimeMinutes: parseNumber(env.AUDIT_LOG_RETENTION_MAX_RUNTIME_MINUTES, 5),
    dryRun: parseBool(env.AUDIT_LOG_RETENTION_DRY_RUN, false),
  };

  const metrics = {
    enabled: parseBool(env.AUDIT_LOG_METRICS_ENABLED, false),
    actionTypesWhitelist: parseCsv(env.AUDIT_LOG_METRICS_ACTION_TYPES).map((s) =>
      s.toUpperCase()
    ),
  };

  return {
    retention: auditLogRetentionSchema.parse(retention),
    metrics: auditLogMetricsSchema.parse(metrics),
  };
}
