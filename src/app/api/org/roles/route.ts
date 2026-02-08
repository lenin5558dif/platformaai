import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { createAuthorizer, requireSession, toErrorResponse } from "@/lib/authorize";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";
import { HttpError } from "@/lib/http-error";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  permissionKeys: z.array(z.string()).min(0),
});

export async function GET() {
  try {
    const session = await requireSession();
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgMembership();
    const canReadRoles =
      membership.permissionKeys.has(ORG_PERMISSIONS.ORG_ROLE_CHANGE) ||
      membership.permissionKeys.has(ORG_PERMISSIONS.ORG_AUDIT_READ) ||
      membership.permissionKeys.has(ORG_PERMISSIONS.ORG_ANALYTICS_READ);

    if (!canReadRoles) {
      throw new HttpError(403, "FORBIDDEN", "Missing permission to read roles");
    }

    const roles = await prisma.orgRole.findMany({
      where: { orgId: membership.orgId },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
        _count: {
          select: {
            memberships: true,
            invites: true,
          },
        },
      },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    });

    const data = roles.map((role) => ({
      id: role.id,
      name: role.name,
      isSystem: role.isSystem,
      permissionKeys: role.permissions.map((rp) => rp.permission.key),
      usageCount: role._count.memberships + role._count.invites,
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString(),
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
      ORG_PERMISSIONS.ORG_ROLE_CHANGE
    );

    const payload = createSchema.parse(await request.json());

    // Validate permission keys exist
    if (payload.permissionKeys.length > 0) {
      const existingPermissions = await prisma.orgPermission.findMany({
        where: {
          key: {
            in: payload.permissionKeys,
          },
        },
        select: { key: true },
      });

      const existingKeys = new Set(existingPermissions.map((p) => p.key));
      const invalidKeys = payload.permissionKeys.filter((k) => !existingKeys.has(k));

      if (invalidKeys.length > 0) {
        throw new HttpError(
          400,
          "INVALID_PERMISSION_KEYS",
          `Unknown permission keys: ${invalidKeys.join(", ")}`
        );
      }
    }

    // Check for duplicate role name in org
    const existingRole = await prisma.orgRole.findUnique({
      where: {
        orgId_name: {
          orgId: membership.orgId,
          name: payload.name,
        },
      },
    });

    if (existingRole) {
      throw new HttpError(409, "ROLE_EXISTS", "Role with this name already exists");
    }

    // Create role with permissions in transaction
    const role = await prisma.$transaction(async (tx) => {
      const newRole = await tx.orgRole.create({
        data: {
          orgId: membership.orgId,
          name: payload.name,
          isSystem: false,
        },
      });

      if (payload.permissionKeys.length > 0) {
        const permissions = await tx.orgPermission.findMany({
          where: {
            key: {
              in: payload.permissionKeys,
            },
          },
          select: { id: true, key: true },
        });

        await tx.orgRolePermission.createMany({
          data: permissions.map((p) => ({
            roleId: newRole.id,
            permissionId: p.id,
          })),
        });
      }

      return newRole;
    });

    await logAudit({
      action: "USER_UPDATED", // Reuse existing action or could add ROLE_CREATED
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "role",
      targetId: role.id,
      metadata: { name: payload.name, permissionKeys: payload.permissionKeys },
    });

    return NextResponse.json(
      {
        data: {
          id: role.id,
          name: role.name,
          isSystem: false,
          permissionKeys: payload.permissionKeys,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
