import { NextResponse } from "next/server";
import { z } from "zod";
import { AuditAction } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { requireSession, toErrorResponse } from "@/lib/authorize";
import { SYSTEM_ROLE_NAMES } from "@/lib/org-permissions";
import {
  hashInviteToken,
  inviteTokenPrefix,
  normalizeInviteEmail,
  tokenHashesEqual,
} from "@/lib/org-invites";
import {
  checkRateLimit,
  getRateLimitHeaders,
  getRetryAfterHeader,
} from "@/lib/rate-limit";

function toLegacyRole(roleName: string) {
  if (roleName === SYSTEM_ROLE_NAMES.ADMIN || roleName === SYSTEM_ROLE_NAMES.OWNER) {
    return "ADMIN" as const;
  }
  return "EMPLOYEE" as const;
}

const acceptSchema = z.object({
  token: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const payload = acceptSchema.parse(await request.json());

    const sessionEmailRaw = session.user.email ?? undefined;
    if (!sessionEmailRaw) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing session email");
    }
    const sessionEmail = normalizeInviteEmail(sessionEmailRaw);

    const token = payload.token;
    const tokenPrefix = inviteTokenPrefix(token);
    const tokenHash = hashInviteToken(token);

    // Rate limit: 5 attempts per 15 minutes per token (anti-bruteforce)
    const acceptRateLimitKey = `invite:accept:${tokenHash}`;
    const acceptRateLimit = await checkRateLimit({
      key: acceptRateLimitKey,
      limit: 5,
      windowMs: 15 * 60 * 1000,
    });
    if (!acceptRateLimit.ok) {
      await logAudit({
        action: AuditAction.ORG_INVITE_ACCEPT_RATE_LIMITED,
        orgId: session.user.orgId ?? undefined,
        actorId: session.user.id,
        targetType: null,
        targetId: null,
        ip: request.headers.get("x-forwarded-for") ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
        metadata: {
          invite: {
            tokenPrefix,
            rateLimited: true,
          },
        },
      });

      return NextResponse.json(
        {
          error: "Too many attempts. Please try again later.",
          code: "RATE_LIMITED",
        },
        {
          status: 429,
          headers: {
            ...getRateLimitHeaders({
              limit: 5,
              remaining: acceptRateLimit.remaining,
              resetAt: acceptRateLimit.resetAt,
            }),
            ...getRetryAfterHeader(acceptRateLimit.resetAt),
          },
        }
      );
    }

    const candidates = await prisma.orgInvite.findMany({
      where: { tokenPrefix },
      select: {
        id: true,
        orgId: true,
        email: true,
        roleId: true,
        defaultCostCenterId: true,
        role: {
          select: { name: true },
        },
        tokenHash: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
      },
      take: 10,
    });

    const invite = candidates.find((c) => tokenHashesEqual(c.tokenHash, tokenHash));
    if (!invite) {
      throw new HttpError(400, "INVALID_TOKEN", "Invalid invite token");
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

    const inviteEmail = normalizeInviteEmail(invite.email);
    if (inviteEmail !== sessionEmail) {
      throw new HttpError(
        403,
        "INVITE_EMAIL_MISMATCH",
        "Invite email does not match"
      );
    }

    const emailVerifiedByProvider = session.user.emailVerifiedByProvider;
    if (emailVerifiedByProvider === false) {
      await logAudit({
        action: AuditAction.ORG_INVITE_ACCEPT_REJECTED_UNVERIFIED,
        orgId: invite.orgId,
        actorId: session.user.id,
        targetType: "OrgInvite",
        targetId: invite.id,
        ip: request.headers.get("x-forwarded-for") ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
        metadata: {
          invite: {
            email: inviteEmail,
            rejected: true,
            reason: "email_not_verified",
          },
        },
      });

      throw new HttpError(403, "EMAIL_NOT_VERIFIED", "Email not verified");
    }

    const existingOrgId = session.user.orgId ?? null;
    if (existingOrgId && existingOrgId !== invite.orgId) {
      throw new HttpError(
        409,
        "ORG_MISMATCH",
        "User already belongs to a different organization"
      );
    }

    let safeDefaultCostCenterId: string | null = null;
    if (invite.defaultCostCenterId) {
      const costCenter = await prisma.costCenter.findFirst({
        where: {
          id: invite.defaultCostCenterId,
          orgId: invite.orgId,
        },
        select: { id: true },
      });
      safeDefaultCostCenterId = costCenter?.id ?? null;
    }

    await prisma.$transaction(async (tx) => {
      const nextLegacyRole = toLegacyRole(invite.role.name);
      await tx.user.update({
        where: { id: session.user.id },
        data: !existingOrgId
          ? { orgId: invite.orgId, role: nextLegacyRole }
          : { role: nextLegacyRole },
        select: { id: true },
      });

      await tx.orgMembership.upsert({
        where: {
          orgId_userId: {
            orgId: invite.orgId,
            userId: session.user.id,
          },
        },
        update: {
          roleId: invite.roleId,
          defaultCostCenterId: safeDefaultCostCenterId,
        },
        create: {
          orgId: invite.orgId,
          userId: session.user.id,
          roleId: invite.roleId,
          defaultCostCenterId: safeDefaultCostCenterId,
        },
      });

      await tx.orgInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date() },
        select: { id: true },
      });
    });

    await logAudit({
      action: AuditAction.USER_UPDATED,
      orgId: invite.orgId,
      actorId: session.user.id,
      targetType: "OrgInvite",
      targetId: invite.id,
      ip: request.headers.get("x-forwarded-for") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
      metadata: {
        invite: {
          email: inviteEmail,
          accepted: true,
        },
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
