import { loadAuditLogOpsConfig } from "@/lib/audit-log-config";

let started = false;
let timer: NodeJS.Timeout | null = null;

export function startAuditLogPurgeScheduler() {
  if (started) return { ok: true as const };

  const cfg = loadAuditLogOpsConfig();
  const intervalMs = Number(process.env.AUDIT_LOG_PURGE_INTERVAL_MS ?? 0);
  if (!cfg.retention.enabled || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    started = true;
    return { ok: true as const, skipped: true as const };
  }

  started = true;
  timer = setInterval(() => {
    void import("@/lib/audit-log-purge-job")
      .then((m) => m.runAuditLogPurgeJob())
      .catch(() => undefined);
  }, intervalMs);

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  return { ok: true as const, stopped: stop };
}
