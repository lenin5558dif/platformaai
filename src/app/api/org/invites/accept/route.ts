import { NextResponse } from "next/server";
import { z } from "zod";
import { AuditAction } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { requireSession, toErrorResponse } from "@/lib/authorize";
import {
  hashInviteToken,
  inviteTokenPrefix,
  normalizeInviteEmail,
  tokenHashesEqual,
} from "@/lib/org-invites";
import {
  checkRateLimit,
  getClientIp,
  getRateLimitHeaders,
  getRetryAfterHeader,
} from "@/lib/rate-limit";
import {
  evaluateAuthEmailGuardrails,
  loadAuthEmailGuardrails,
} from "@/lib/auth-ui";

const acceptSchema = z.object({
  token: z.string().min(1),
});

const inviteEmailGuardrails = loadAuthEmailGuardrails();

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const payload = acceptSchema.parse(await request.json());

    const sessionEmailRaw = session.user.email ?? undefined;
    if (!sessionEmailRaw) {
      throw new HttpError(
        401,
        "EMAIL_REQUIRED",
        "Invite acceptance requires an email-backed account"
      );
    }
    const sessionEmail = normalizeInviteEmail(sessionEmailRaw);
    const emailDecision = evaluateAuthEmailGuardrails(
      sessionEmail,
      inviteEmailGuardrails
    );

    if (emailDecision.blocked) {
      await logAudit({
        action: AuditAction.POLICY_BLOCKED,
        orgId: session.user.orgId ?? undefined,
        actorId: session.user.id,
        targetType: "OrgInvite",
        targetId: null,
        ip: request.headers.get("x-forwarded-for") ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
        metadata: {
          auth: {
            stage: "invite_accept",
            reason: "blocked_email_domain",
            email: emailDecision.normalizedEmail,
            domain: emailDecision.domain,
            blocked: true,
          },
        },
      });

      throw new HttpError(
        403,
        "EMAIL_DOMAIN_BLOCKED",
        "Email domain is blocked by policy"
      );
    }

    const token = payload.token;
    const tokenPrefix = inviteTokenPrefix(token);
    const tokenHash = hashInviteToken(token);
    const clientIp = getClientIp(request);

    // Rate limit: 5 attempts per 15 minutes per invite prefix and per IP (anti-bruteforce)
    const [tokenRateLimit, ipRateLimit] = await Promise.all([
      checkRateLimit({
        key: `invite:accept:${tokenPrefix}`,
        limit: 5,
        windowMs: 15 * 60 * 1000,
      }),
      checkRateLimit({
        key: `invite:accept-ip:${clientIp}`,
        limit: 30,
        windowMs: 15 * 60 * 1000,
      }),
    ]);
    const acceptRateLimit = !tokenRateLimit.ok ? tokenRateLimit : ipRateLimit;
    const acceptRateLimitLimit = !tokenRateLimit.ok ? 5 : 30;
    if (!tokenRateLimit.ok || !ipRateLimit.ok) {
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
                limit: acceptRateLimitLimit,
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
      if (!existingOrgId) {
        await tx.user.update({
          where: { id: session.user.id },
          data: { orgId: invite.orgId },
          select: { id: true },
        });
      }

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
