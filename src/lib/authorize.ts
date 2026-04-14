import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import type { OrgPermissionKey } from "@/lib/org-permissions";
import { HttpError } from "@/lib/http-error";

export type AuthzChannel = "web" | "telegram" | "scim" | "api";

export function toErrorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }

  throw error;
}

function unauthorized() {
  return new HttpError(401, "UNAUTHORIZED", "Unauthorized");
}

function forbidden(message = "Forbidden") {
  return new HttpError(403, "FORBIDDEN", message);
}

type ResolvedMembership = {
  orgId: string;
  roleId: string;
  roleName: string;
  defaultCostCenterId: string | null;
  permissionKeys: Set<string>;
};

export async function requireSession(request?: Request): Promise<Session> {
  const session = await auth(request);
  if (!session?.user?.id) {
    throw unauthorized();
  }
  return session;
}

export async function requireActiveUser(session: Session) {
  // auth() already enforces isActive in DB. This is a defensive assertion.
  if (!session.user?.id) {
    throw unauthorized();
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isActive: true },
  });

  if (!dbUser || dbUser.isActive === false) {
    throw unauthorized();
  }
}

export function createAuthorizer(session: Session) {
  const userId = session.user.id;
  const orgId = session.user.orgId ?? null;

  const membershipCache = new Map<string, ResolvedMembership>();

  async function requireOrgMembership(targetOrgId?: string): Promise<ResolvedMembership> {
    const resolvedOrgId = targetOrgId ?? orgId;
    if (!resolvedOrgId) {
      throw forbidden("No organization");
    }

    const cached = membershipCache.get(resolvedOrgId);
    if (cached) return cached;

    const membership = await prisma.orgMembership.findUnique({
      where: {
        orgId_userId: {
          orgId: resolvedOrgId,
          userId,
        },
      },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    if (!membership) {
      throw forbidden();
    }

    const permissionKeys = new Set(
      membership.role.permissions.map((rp) => rp.permission.key)
    );

    const resolved: ResolvedMembership = {
      orgId: resolvedOrgId,
      roleId: membership.roleId,
      roleName: membership.role.name,
      defaultCostCenterId: membership.defaultCostCenterId ?? null,
      permissionKeys,
    };

    membershipCache.set(resolvedOrgId, resolved);
    return resolved;
  }

  async function requireOrgPermission(
    permissionKey: OrgPermissionKey,
    targetOrgId?: string
  ) {
    const membership = await requireOrgMembership(targetOrgId);
    if (!membership.permissionKeys.has(permissionKey)) {
      throw forbidden();
    }
    return membership;
  }

  return {
    userId,
    orgId,
    requireOrgMembership,
    requireOrgPermission,
  };
}
