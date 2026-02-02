import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { createAuthorizer, requireSession, toErrorResponse } from "@/lib/authorize";
import { ORG_PERMISSIONS, SYSTEM_ROLE_NAMES } from "@/lib/org-permissions";
import { HttpError } from "@/lib/http-error";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  permissionKeys: z.array(z.string()).min(0).optional(),
});

function isSystemRole(name: string): boolean {
  return Object.values(SYSTEM_ROLE_NAMES).includes(name as any);
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireSession();
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_ROLE_CHANGE
    );

    const payload = updateSchema.parse(await request.json());

    // Find role and verify org scoping
    const role = await prisma.orgRole.findFirst({
      where: {
        id,
        orgId: membership.orgId,
      },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    if (!role) {
      throw new HttpError(404, "NOT_FOUND", "Role not found");
    }

    // Cannot modify system roles
    if (role.isSystem || isSystemRole(role.name)) {
      throw new HttpError(403, "SYSTEM_ROLE_IMMUTABLE", "Cannot modify system roles");
    }

    // Validate permission keys if provided
    if (payload.permissionKeys && payload.permissionKeys.length > 0) {
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

    // Check for duplicate name if renaming
    if (payload.name && payload.name !== role.name) {
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
    }

    // Update role with permissions in transaction
    const updatedRole = await prisma.$transaction(async (tx) => {
      // Update name if provided
      if (payload.name) {
        await tx.orgRole.update({
          where: { id },
          data: { name: payload.name },
        });
      }

      // Update permissions if provided
      if (payload.permissionKeys) {
        // Delete existing permissions
        await tx.orgRolePermission.deleteMany({
          where: { roleId: id },
        });

        // Add new permissions
        if (payload.permissionKeys.length > 0) {
          const permissions = await tx.orgPermission.findMany({
            where: {
              key: {
                in: payload.permissionKeys,
              },
            },
            select: { id: true },
          });

          await tx.orgRolePermission.createMany({
            data: permissions.map((p) => ({
              roleId: id,
              permissionId: p.id,
            })),
          });
        }
      }

      return tx.orgRole.findUnique({
        where: { id },
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
      });
    });

    await logAudit({
      action: "USER_UPDATED", // Could add ROLE_UPDATED audit action
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "role",
      targetId: id,
      metadata: {
        name: payload.name,
        permissionKeys: payload.permissionKeys,
      },
    });

    return NextResponse.json({
      data: {
        id: updatedRole!.id,
        name: updatedRole!.name,
        isSystem: updatedRole!.isSystem,
        permissionKeys: updatedRole!.permissions.map((rp) => rp.permission.key),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireSession();
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_ROLE_CHANGE
    );

    // Find role and verify org scoping
    const role = await prisma.orgRole.findFirst({
      where: {
        id,
        orgId: membership.orgId,
      },
      include: {
        _count: {
          select: {
            memberships: true,
            invites: true,
          },
        },
      },
    });

    if (!role) {
      throw new HttpError(404, "NOT_FOUND", "Role not found");
    }

    // Cannot delete system roles
    if (role.isSystem || isSystemRole(role.name)) {
      throw new HttpError(403, "SYSTEM_ROLE_IMMUTABLE", "Cannot delete system roles");
    }

    // Check if role is in use
    const usageCount = role._count.memberships + role._count.invites;
    if (usageCount > 0) {
      throw new HttpError(
        409,
        "ROLE_IN_USE",
        `Role is assigned to ${usageCount} user(s) or invite(s)`
      );
    }

    // Delete role (permissions will cascade)
    await prisma.orgRole.delete({
      where: { id },
    });

    await logAudit({
      action: "USER_UPDATED", // Could add ROLE_DELETED audit action
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "role",
      targetId: id,
      metadata: { name: role.name },
    });

    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
