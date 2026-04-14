import { NextResponse } from "next/server";
import { AuditAction } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";
import { createAuthorizer, requireSession, toErrorResponse } from "@/lib/authorize";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession(request);
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_INVITE_REVOKE
    );

    const { id } = await params;
    const invite = await prisma.orgInvite.findFirst({
      where: { id, orgId: membership.orgId },
      select: {
        id: true,
        email: true,
        revokedAt: true,
        usedAt: true,
      },
    });

    if (!invite) {
      throw new HttpError(404, "NOT_FOUND", "Invite not found");
    }
    if (invite.usedAt) {
      throw new HttpError(409, "INVITE_ALREADY_USED", "Invite already used");
    }

    if (!invite.revokedAt) {
      await prisma.orgInvite.update({
        where: { id: invite.id },
        data: { revokedAt: new Date() },
        select: { id: true },
      });

      await logAudit({
        action: AuditAction.USER_UPDATED,
        orgId: membership.orgId,
        actorId: session.user.id,
        targetType: "OrgInvite",
        targetId: invite.id,
        ip: request.headers.get("x-forwarded-for") ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
        metadata: {
          invite: {
            email: invite.email,
            revoked: true,
          },
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
