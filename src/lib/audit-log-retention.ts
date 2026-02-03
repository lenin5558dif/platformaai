import type { PrismaClient } from "@prisma/client";
import type { AuditLogRetentionConfig } from "@/lib/audit-log-config";
import { recordPurgeMetrics } from "@/lib/audit-metrics";

export type AuditLogPurgeResult = {
  cutoffIso: string;
  dryRun: boolean;
  batches: number;
  scanned: number;
  deleted: number;
  durationMs: number;
  stoppedReason: "completed" | "max_runtime" | "aborted";
  errors: number;
};

export async function purgeAuditLogs(params: {
  prisma: PrismaClient;
  config: AuditLogRetentionConfig;
  now?: Date;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  nowMs?: () => number;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}): Promise<AuditLogPurgeResult> {
  const now = params.now ?? new Date();
  const nowMs = params.nowMs ?? (() => Date.now());
  const sleep = params.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = params.log ?? (() => undefined);

  const startMs = nowMs();
  const maxRuntimeMs = params.config.maxRuntimeMinutes * 60 * 1000;
  const cutoff = new Date(now.getTime() - params.config.days * 24 * 60 * 60 * 1000);

  let batches = 0;
  let scanned = 0;
  let deleted = 0;
  let errors = 0;

  const emitPurgeMetrics = async (stoppedReason: AuditLogPurgeResult["stoppedReason"], durationMs: number) => {
    let oldest: Date | null = null;
    try {
      const first = await params.prisma.auditLog.findFirst({
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      });
      oldest = first?.createdAt ?? null;
    } catch {
      // ignore
    }

    const oldestAgeSeconds = oldest ? (now.getTime() - oldest.getTime()) / 1000 : null;
    recordPurgeMetrics({
      deleted,
      durationSeconds: durationMs / 1000,
      errors,
      nowSeconds: Math.floor(now.getTime() / 1000),
      oldestRetainedAgeSeconds: oldestAgeSeconds,
    });

    return stoppedReason;
  };

  while (true) {
    if (params.signal?.aborted) {
      const durationMs = nowMs() - startMs;
      await emitPurgeMetrics("aborted", durationMs);
      return {
        cutoffIso: cutoff.toISOString(),
        dryRun: params.config.dryRun,
        batches,
        scanned,
        deleted,
        durationMs,
        stoppedReason: "aborted",
        errors,
      };
    }

    const elapsedMs = nowMs() - startMs;
    if (elapsedMs >= maxRuntimeMs) {
      await emitPurgeMetrics("max_runtime", elapsedMs);

      return {
        cutoffIso: cutoff.toISOString(),
        dryRun: params.config.dryRun,
        batches,
        scanned,
        deleted,
        durationMs: elapsedMs,
        stoppedReason: "max_runtime",
        errors,
      };
    }

    let batch: { id: string; createdAt: Date }[];
    try {
      batch = await params.prisma.auditLog.findMany({
        where: { createdAt: { lte: cutoff } },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: params.config.batchSize,
      });
    } catch {
      errors += 1;
      await emitPurgeMetrics("completed", nowMs() - startMs);
      return {
        cutoffIso: cutoff.toISOString(),
        dryRun: params.config.dryRun,
        batches,
        scanned,
        deleted,
        durationMs: nowMs() - startMs,
        stoppedReason: "completed",
        errors,
      };
    }

    if (batch.length === 0) {
      const durationMs = nowMs() - startMs;
      await emitPurgeMetrics("completed", durationMs);
      return {
        cutoffIso: cutoff.toISOString(),
        dryRun: params.config.dryRun,
        batches,
        scanned,
        deleted,
        durationMs,
        stoppedReason: "completed",
        errors,
      };
    }

    batches += 1;
    scanned += batch.length;

    const oldest = batch[0]?.createdAt?.toISOString();
    const newest = batch[batch.length - 1]?.createdAt?.toISOString();

    if (params.config.dryRun) {
      deleted += batch.length;
      log("audit_log_purge_batch_dry_run", {
        batch: batches,
        count: batch.length,
        oldest,
        newest,
      });
    } else {
      try {
        const res = await params.prisma.auditLog.deleteMany({
          where: { id: { in: batch.map((r) => r.id) } },
        });
        deleted += res.count;
        log("audit_log_purge_batch_deleted", {
          batch: batches,
          count: res.count,
          oldest,
          newest,
        });
      } catch {
        errors += 1;
        log("audit_log_purge_batch_error", { batch: batches });
      }
    }

    if (params.config.batchDelayMs > 0) {
      await sleep(params.config.batchDelayMs);
    }
  }
}
