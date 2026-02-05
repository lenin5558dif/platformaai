import { NextResponse } from "next/server";
import { AuditAction } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";
import { createAuthorizer, requireSession, toErrorResponse } from "@/lib/authorize";
import { revokeAllSessionsForUser } from "@/lib/session-revoke";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession(request);
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_USER_MANAGE
    );

    const { id } = await params;
    const targetUser = await prisma.user.findFirst({
      where: { id, orgId: membership.orgId },
      select: { id: true },
    });

    if (!targetUser) {
      throw new HttpError(404, "NOT_FOUND", "User not found");
    }

    const { revokedAt, deletedSessions } = await revokeAllSessionsForUser(
      targetUser.id
    );

    await logAudit({
      action: AuditAction.USER_UPDATED,
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "User",
      targetId: targetUser.id,
      ip: request.headers.get("x-forwarded-for") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
      metadata: {
        sessionGlobalRevoke: {
          mode: "ADMIN",
          revokedAt: revokedAt.toISOString(),
          deletedSessions,
        },
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
