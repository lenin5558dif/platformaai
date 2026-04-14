import "@/lib/env";

import { prisma } from "@/lib/db";
import { loadAuditLogOpsConfig } from "@/lib/audit-log-config";

export type OpsCheck = {
  name: string;
  ok: boolean;
  latencyMs?: number;
  error?: string;
};

export type HealthStatus = {
  status: "ok";
  service: string;
  timestamp: string;
  uptimeSeconds: number;
  nodeEnv: string;
  version: string;
};

export type ReadinessStatus = {
  status: "ready" | "not_ready";
  service: string;
  timestamp: string;
  checks: OpsCheck[];
};

export type OpsStatus = ReadinessStatus & {
  runtime: {
    nodeEnv: string;
    cronSecretConfigured: boolean;
    auditLogPurgeSchedulerEnabled: boolean;
  };
  auditLog: {
    ok: boolean;
    error?: string;
    retentionEnabled: boolean;
    retentionDays: number;
    retentionBatchSize: number;
    retentionBatchDelayMs: number;
    retentionMaxRuntimeMinutes: number;
    retentionDryRun: boolean;
    metricsEnabled: boolean;
    metricsActionTypesWhitelist: string[];
  };
};

async function checkDatabase(): Promise<OpsCheck> {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      name: "database",
      ok: true,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      name: "database",
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "DATABASE_UNAVAILABLE",
    };
  }
}

function checkAuditLogConfig(): OpsCheck {
  const startedAt = Date.now();
  try {
    loadAuditLogOpsConfig();
    return {
      name: "audit_log_config",
      ok: true,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      name: "audit_log_config",
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "AUDIT_LOG_CONFIG_INVALID",
    };
  }
}

export function getHealthStatus(): HealthStatus {
  return {
    status: "ok",
    service: "platformaai",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    nodeEnv: process.env.NODE_ENV ?? "unknown",
    version: process.env.npm_package_version ?? "unknown",
  };
}

export async function getReadinessStatus(): Promise<ReadinessStatus> {
  const checks = await Promise.all([checkDatabase(), Promise.resolve(checkAuditLogConfig())]);
  return {
    status: checks.every((check) => check.ok) ? "ready" : "not_ready",
    service: "platformaai",
    timestamp: new Date().toISOString(),
    checks,
  };
}

export async function getOpsStatus(): Promise<OpsStatus> {
  const readiness = await getReadinessStatus();
  try {
    const cfg = loadAuditLogOpsConfig();
    return {
      ...readiness,
      runtime: {
        nodeEnv: process.env.NODE_ENV ?? "unknown",
        cronSecretConfigured: Boolean(process.env.CRON_SECRET),
        auditLogPurgeSchedulerEnabled: Number(process.env.AUDIT_LOG_PURGE_INTERVAL_MS ?? 0) > 0,
      },
      auditLog: {
        ok: true,
        retentionEnabled: cfg.retention.enabled,
        retentionDays: cfg.retention.days,
        retentionBatchSize: cfg.retention.batchSize,
        retentionBatchDelayMs: cfg.retention.batchDelayMs,
        retentionMaxRuntimeMinutes: cfg.retention.maxRuntimeMinutes,
        retentionDryRun: cfg.retention.dryRun,
        metricsEnabled: cfg.metrics.enabled,
        metricsActionTypesWhitelist: cfg.metrics.actionTypesWhitelist,
      },
    };
  } catch (error) {
    return {
      ...readiness,
      status: "not_ready",
      runtime: {
        nodeEnv: process.env.NODE_ENV ?? "unknown",
        cronSecretConfigured: Boolean(process.env.CRON_SECRET),
        auditLogPurgeSchedulerEnabled: Number(process.env.AUDIT_LOG_PURGE_INTERVAL_MS ?? 0) > 0,
      },
      auditLog: {
        ok: false,
        error: error instanceof Error ? error.message : "AUDIT_LOG_CONFIG_INVALID",
        retentionEnabled: false,
        retentionDays: 0,
        retentionBatchSize: 0,
        retentionBatchDelayMs: 0,
        retentionMaxRuntimeMinutes: 0,
        retentionDryRun: false,
        metricsEnabled: false,
        metricsActionTypesWhitelist: [],
      },
    };
  }
}
