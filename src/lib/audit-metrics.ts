import type { AuditAction } from "@prisma/client";
import { loadAuditLogOpsConfig } from "@/lib/audit-log-config";
import { metricsRegistry } from "@/lib/metrics";

const entriesTotal = metricsRegistry.counter(
  "audit_log_entries_total",
  "Total audit log entries created",
  ["action_type", "entity_type"]
);

const purgeRecordsTotal = metricsRegistry.counter(
  "audit_log_purge_records_total",
  "Total audit log records purged",
  []
);

const purgeErrorsTotal = metricsRegistry.counter(
  "audit_log_purge_errors_total",
  "Total errors during audit log purge",
  []
);

const purgeDuration = metricsRegistry.histogram(
  "audit_log_purge_duration_seconds",
  "Audit log purge duration in seconds",
  []
);

const purgeLastSuccessTs = metricsRegistry.gauge(
  "audit_log_purge_last_success_timestamp_seconds",
  "Unix timestamp of last successful audit log purge",
  []
);

const oldestRetainedAge = metricsRegistry.gauge(
  "audit_log_oldest_retained_age_seconds",
  "Age in seconds of the oldest retained audit log entry",
  []
);

const auditErrorsTotal = metricsRegistry.counter(
  "audit_log_errors_total",
  "Total audit log operation errors",
  ["error_type"]
);

function sanitizeLabelValue(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  const v = value.trim();
  if (v.length === 0) return fallback;
  if (v.length > 32) return fallback;
  if (!/^[A-Za-z0-9_]+$/.test(v)) return fallback;
  return v;
}

function auditActionType(action: AuditAction): string {
  const a = String(action);
  switch (a) {
    case "USER_INVITED":
    case "ORG_INVITE_RESENT":
    case "SCIM_TOKEN_CREATED":
      return "CREATE";

    case "USER_UPDATED":
    case "ORG_UPDATED":
    case "DLP_POLICY_UPDATED":
    case "MODEL_POLICY_UPDATED":
    case "SSO_DOMAIN_UPDATED":
    case "COST_CENTER_UPDATED":
    case "COST_CENTER_ASSIGNED":
    case "SCIM_TOKEN_REVOKED":
    case "SCIM_USER_SYNC":
    case "SCIM_GROUP_SYNC":
      return "UPDATE";

    case "COST_CENTER_DELETED":
    case "USER_DISABLED":
      return "DELETE";

    case "TELEGRAM_LINKED":
    case "TELEGRAM_UNLINKED":
    case "ORG_INVITE_ACCEPT_REJECTED_UNVERIFIED":
    case "ORG_INVITE_ACCEPT_RATE_LIMITED":
      return "AUTH";

    case "POLICY_BLOCKED":
      return "POLICY";

    case "BILLING_REFILL":
      return "BILLING";

    default:
      return "OTHER";
  }
}

function isWhitelistedActionType(actionType: string, whitelist: string[]) {
  if (whitelist.length === 0) return true;
  return whitelist.includes(actionType);
}

export function recordAuditEntry(params: {
  action: AuditAction;
  targetType?: string | null;
}) {
  const cfg = loadAuditLogOpsConfig();
  if (!cfg.metrics.enabled) return;

  const rawActionType = auditActionType(params.action);
  const actionType = isWhitelistedActionType(rawActionType, cfg.metrics.actionTypesWhitelist)
    ? rawActionType
    : "OTHER";

  const entityType = sanitizeLabelValue(
    (params.targetType ?? "UNKNOWN").toUpperCase(),
    "UNKNOWN"
  );

  metricsRegistry.incCounter(entriesTotal, {
    action_type: actionType,
    entity_type: entityType,
  });
}

export function recordAuditError(errorType: string) {
  const cfg = loadAuditLogOpsConfig();
  if (!cfg.metrics.enabled) return;

  metricsRegistry.incCounter(auditErrorsTotal, {
    error_type: sanitizeLabelValue(errorType.toUpperCase(), "UNKNOWN"),
  });
}

export function recordPurgeMetrics(params: {
  deleted: number;
  durationSeconds: number;
  errors: number;
  nowSeconds?: number;
  oldestRetainedAgeSeconds?: number | null;
}) {
  const cfg = loadAuditLogOpsConfig();
  if (!cfg.metrics.enabled) return;

  if (params.deleted > 0) {
    metricsRegistry.incCounter(purgeRecordsTotal, undefined, params.deleted);
  }
  if (params.errors > 0) {
    metricsRegistry.incCounter(purgeErrorsTotal, undefined, params.errors);
  }
  metricsRegistry.observeHistogram(purgeDuration, undefined, params.durationSeconds);

  if (typeof params.nowSeconds === "number") {
    metricsRegistry.setGauge(purgeLastSuccessTs, undefined, params.nowSeconds);
  }
  if (typeof params.oldestRetainedAgeSeconds === "number") {
    metricsRegistry.setGauge(oldestRetainedAge, undefined, params.oldestRetainedAgeSeconds);
  }
}

export const __metrics = {
  entriesTotal,
  purgeRecordsTotal,
  purgeErrorsTotal,
  purgeDuration,
  purgeLastSuccessTs,
  oldestRetainedAge,
  auditErrorsTotal,
};
