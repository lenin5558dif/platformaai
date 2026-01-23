import { prisma } from "@/lib/db";
import type { AuditAction, Prisma } from "@prisma/client";

export async function logAudit(params: {
  action: AuditAction;
  orgId?: string | null;
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  const enabled = process.env.AUDIT_LOG_ENABLED !== "0";
  if (!enabled) return;

  try {
    await prisma.auditLog.create({
      data: {
        action: params.action,
        orgId: params.orgId ?? undefined,
        actorId: params.actorId ?? undefined,
        targetType: params.targetType ?? undefined,
        targetId: params.targetId ?? undefined,
        ip: params.ip ?? undefined,
        userAgent: params.userAgent ?? undefined,
        metadata: params.metadata ?? undefined,
      },
    });
  } catch {
    // Avoid cascading failures from audit logging.
  }
}
