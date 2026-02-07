import { PrismaClient } from "@prisma/client";
import { startAuditLogPurgeScheduler } from "@/lib/audit-log-purge-scheduler";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Optional in-process scheduling for self-hosted deployments.
// Disabled by default; enable with AUDIT_LOG_PURGE_INTERVAL_MS + AUDIT_LOG_RETENTION_ENABLED.
if (process.env.AUDIT_LOG_PURGE_INTERVAL_MS) {
  startAuditLogPurgeScheduler();
}
