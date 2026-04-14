import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { createAuthorizer, requireSession, toErrorResponse } from "@/lib/authorize";
import { ORG_PERMISSIONS, SYSTEM_ROLE_NAMES } from "@/lib/org-permissions";
import { ensureOrgSystemRolesAndPermissions } from "@/lib/org-rbac";
import { HttpError } from "@/lib/http-error";

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["USER", "ADMIN", "EMPLOYEE"]).optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgMembership();
    const canReadUsers =
      membership.permissionKeys.has(ORG_PERMISSIONS.ORG_USER_MANAGE) ||
      membership.permissionKeys.has(ORG_PERMISSIONS.ORG_ROLE_CHANGE) ||
      membership.permissionKeys.has(ORG_PERMISSIONS.ORG_AUDIT_READ) ||
      membership.permissionKeys.has(ORG_PERMISSIONS.ORG_ANALYTICS_READ);

    if (!canReadUsers) {
      throw new HttpError(403, "FORBIDDEN", "Missing permission to read org users");
    }

    const orgMemberships = await prisma.orgMembership.findMany({
      where: { orgId: membership.orgId },
      orderBy: { createdAt: "asc" },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: {
                  select: { key: true },
                },
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            balance: true,
            dailyLimit: true,
            monthlyLimit: true,
            isActive: true,
            costCenterId: true,
          },
        },
      },
    });

    const data = orgMemberships.map((entry) => ({
      id: entry.user.id,
      email: entry.user.email,
      legacyRole: entry.user.role,
      balance: entry.user.balance.toString(),
      dailyLimit: entry.user.dailyLimit?.toString() ?? null,
      monthlyLimit: entry.user.monthlyLimit?.toString() ?? null,
      isActive: entry.user.isActive,
      costCenterId: entry.user.costCenterId,
      defaultCostCenterId: entry.defaultCostCenterId,
      role: {
        id: entry.role.id,
        name: entry.role.name,
        permissionKeys: entry.role.permissions.map((item) => item.permission.key),
      },
    }));

    return NextResponse.json({ data });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_USER_MANAGE
    );

    const payload = inviteSchema.parse(await request.json());
    const user = await prisma.user.upsert({
      where: { email: payload.email },
      update: { orgId: membership.orgId, role: payload.role ?? "EMPLOYEE" },
      create: {
        email: payload.email,
        orgId: membership.orgId,
        role: payload.role ?? "EMPLOYEE",
        balance: 0,
      },
    });

    // Ensure the invited user has an org membership entry for RBAC enforcement.
    const { rolesByName } = await ensureOrgSystemRolesAndPermissions(membership.orgId);
    const roleName = payload.role === "ADMIN" ? SYSTEM_ROLE_NAMES.ADMIN : SYSTEM_ROLE_NAMES.MEMBER;
    const orgRole = rolesByName.get(roleName) ?? rolesByName.get(SYSTEM_ROLE_NAMES.MEMBER);

    if (orgRole) {
      await prisma.orgMembership.upsert({
        where: {
          orgId_userId: {
            orgId: membership.orgId,
            userId: user.id,
          },
        },
        update: {
          roleId: orgRole.id,
        },
        create: {
          orgId: membership.orgId,
          userId: user.id,
          roleId: orgRole.id,
        },
      });
    }

    await logAudit({
      action: "USER_INVITED",
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "user",
      targetId: user.id,
      metadata: { email: user.email, role: user.role },
    });

    return NextResponse.json(
      { data: { id: user.id, email: user.email } },
      { status: 201 }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
