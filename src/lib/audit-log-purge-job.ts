import { loadAuditLogOpsConfig } from "@/lib/audit-log-config";
import { recordAuditError } from "@/lib/audit-metrics";
import { purgeAuditLogs } from "@/lib/audit-log-retention";
import { prisma } from "@/lib/db";

let running: Promise<unknown> | null = null;

export async function runAuditLogPurgeJob(params?: { signal?: AbortSignal }) {
  if (running) {
    return { ok: true, skipped: true, reason: "already_running" } as const;
  }

  const job = (async () => {
    const cfg = loadAuditLogOpsConfig();
    if (!cfg.retention.enabled) {
      return { ok: true, skipped: true, reason: "disabled" } as const;
    }

    const startedAtMs = Date.now();
    const result = await purgeAuditLogs({
      prisma,
      config: cfg.retention,
      signal: params?.signal,
      log: (msg, meta) => {
        // Keep logs low-cardinality; do not include IDs.
        // eslint-disable-next-line no-console
        console.log(msg, meta ?? {});
      },
    });

    return {
      ok: true,
      skipped: false,
      jobDurationMs: Date.now() - startedAtMs,
      ...result,
    } as const;
  })();

  running = job;
  try {
    return await job;
  } catch {
    recordAuditError("purge_job");
    return { ok: false, error: "PURGE_FAILED" } as const;
  } finally {
    running = null;
  }
}
