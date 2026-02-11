import { NextResponse } from "next/server";
import { z } from "zod";
import { AuditAction } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";
import { createAuthorizer, requireSession, toErrorResponse } from "@/lib/authorize";
import {
  buildInviteAcceptUrl,
  generateInviteToken,
} from "@/lib/org-invites";
import { sendOrgInviteEmail } from "@/lib/unisender";
import {
  checkRateLimit,
  getRateLimitHeaders,
  getRetryAfterHeader,
} from "@/lib/rate-limit";

const createInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  roleId: z.string().min(1),
  defaultCostCenterId: z.string().min(1).optional().nullable(),
});

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET() {
  try {
    const session = await requireSession();
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_INVITE_CREATE
    );

    const now = new Date();
    const invites = await prisma.orgInvite.findMany({
      where: {
        orgId: membership.orgId,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        roleId: true,
        defaultCostCenterId: true,
        tokenPrefix: true,
        expiresAt: true,
        createdAt: true,
        role: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ data: invites });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_INVITE_CREATE
    );

    // Rate limit: 10 invites per hour per user/org
    const rateLimitKey = `invite:create:${session.user.id}:${membership.orgId}`;
    const rateLimit = checkRateLimit({
      key: rateLimitKey,
      limit: 10,
      windowMs: 3600000,
    });
    if (!rateLimit.ok) {
      return NextResponse.json(
        {
          error: "Too many invites. Please try again later.",
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

    const payload = createInviteSchema.parse(await request.json());
    const email = payload.email;
    const now = new Date();

    const role = await prisma.orgRole.findFirst({
      where: { id: payload.roleId, orgId: membership.orgId },
      select: { id: true, name: true },
    });
    if (!role) {
      throw new HttpError(404, "ROLE_NOT_FOUND", "Role not found");
    }

    const defaultCostCenterId = payload.defaultCostCenterId ?? null;
    if (defaultCostCenterId) {
      const costCenter = await prisma.costCenter.findFirst({
        where: { id: defaultCostCenterId, orgId: membership.orgId },
        select: { id: true },
      });
      if (!costCenter) {
        throw new HttpError(400, "INVALID_COST_CENTER", "Cost center not found");
      }
    }

    const existing = await prisma.orgInvite.findFirst({
      where: {
        orgId: membership.orgId,
        email,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (existing) {
      throw new HttpError(409, "INVITE_EXISTS", "Invite already exists");
    }

    const { token, tokenHash, tokenPrefix } = generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invite = await prisma.orgInvite.create({
      data: {
        orgId: membership.orgId,
        email,
        roleId: role.id,
        defaultCostCenterId,
        tokenHash,
        tokenPrefix,
        expiresAt,
        createdById: session.user.id,
      },
      select: {
        id: true,
        email: true,
        roleId: true,
        tokenPrefix: true,
        expiresAt: true,
      },
    });

    const acceptUrl = buildInviteAcceptUrl(token);
    await sendOrgInviteEmail({ email, acceptUrl });

    await logAudit({
      action: AuditAction.USER_INVITED,
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "OrgInvite",
      targetId: invite.id,
      ip: request.headers.get("x-forwarded-for") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
      metadata: {
        invite: {
          email,
          roleId: role.id,
          roleName: role.name,
          tokenPrefix,
          expiresAt: expiresAt.toISOString(),
        },
      },
    });

    return NextResponse.json(
      {
        data: {
          ...invite,
          ...(process.env.NODE_ENV === "test" ? { acceptUrl, token } : {}),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
