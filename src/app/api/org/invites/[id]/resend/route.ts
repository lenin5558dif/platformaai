import { NextResponse } from "next/server";
import { AuditAction } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";
import { createAuthorizer, requireSession, toErrorResponse } from "@/lib/authorize";
import { buildInviteAcceptUrl, generateInviteToken } from "@/lib/org-invites";
import { sendOrgInviteEmail } from "@/lib/unisender";
import {
  checkRateLimit,
  getRateLimitHeaders,
  getRetryAfterHeader,
} from "@/lib/rate-limit";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireSession(request);
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_INVITE_CREATE
    );

    // Rate limit: 10 resends per hour per user/org
    const rateLimitKey = `invite:resend:${session.user.id}:${membership.orgId}`;
    const rateLimit = checkRateLimit({
      key: rateLimitKey,
      limit: 10,
      windowMs: 3600000,
    });
    if (!rateLimit.ok) {
      return NextResponse.json(
        {
          error: "Too many invite resends. Please try again later.",
          code: "RATE_LIMITED",
        },
        {
          status: 429,
          headers: {
            ...getRateLimitHeaders({
              limit: 10,
              remaining: rateLimit.remaining,
              resetAt: rateLimit.resetAt,
            }),
            ...getRetryAfterHeader(rateLimit.resetAt),
          },
        }
      );
    }

    const invite = await prisma.orgInvite.findFirst({
      where: { id: params.id, orgId: membership.orgId },
      select: {
        id: true,
        orgId: true,
        email: true,
        roleId: true,
        defaultCostCenterId: true,
        usedAt: true,
        revokedAt: true,
        expiresAt: true,
        role: { select: { id: true, name: true } },
      },
    });

    if (!invite) {
      throw new HttpError(404, "NOT_FOUND", "Invite not found");
    }
    if (invite.usedAt) {
      throw new HttpError(409, "INVITE_ALREADY_USED", "Invite already used");
    }
    if (invite.revokedAt) {
      throw new HttpError(410, "INVITE_REVOKED", "Invite revoked");
    }
    if (invite.expiresAt <= new Date()) {
      throw new HttpError(410, "INVITE_EXPIRED", "Invite expired");
    }

    const { token, tokenHash, tokenPrefix } = generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    await prisma.orgInvite.update({
      where: { id: invite.id },
      data: {
        tokenHash,
        tokenPrefix,
        expiresAt,
      },
      select: { id: true },
    });

    const acceptUrl = buildInviteAcceptUrl(token);
    await sendOrgInviteEmail({ email: invite.email, acceptUrl });

    await logAudit({
      action: AuditAction.ORG_INVITE_RESENT,
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "OrgInvite",
      targetId: invite.id,
      ip: request.headers.get("x-forwarded-for") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
      metadata: {
        invite: {
          email: invite.email,
          roleId: invite.roleId,
          roleName: invite.role?.name,
          tokenPrefix,
          expiresAt: expiresAt.toISOString(),
          resent: true,
        },
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
