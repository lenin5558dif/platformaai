import { NextResponse } from "next/server";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { HttpError, createAuthorizer, requireSession, toErrorResponse } from "@/lib/authorize";
import { ORG_PERMISSIONS, SYSTEM_ROLE_NAMES } from "@/lib/org-permissions";

const patchSchema = z
  .object({
    roleId: z.string().min(1).optional(),
    roleName: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.roleId) !== Boolean(v.roleName), {
    message: "Provide exactly one of roleId or roleName",
  });

async function getOwnerRoleId(orgId: string): Promise<string | null> {
  const ownerRole = await prisma.orgRole.findUnique({
    where: {
      orgId_name: {
        orgId,
        name: SYSTEM_ROLE_NAMES.OWNER,
      },
    },
    select: { id: true },
  });
  return ownerRole?.id ?? null;
}

async function assertNotLastOwner(orgId: string, ownerRoleId: string, targetUserId: string) {
  const targetIsOwner = await prisma.orgMembership.findUnique({
    where: {
      orgId_userId: {
        orgId,
        userId: targetUserId,
      },
    },
    select: { roleId: true },
  });

  if (!targetIsOwner || targetIsOwner.roleId !== ownerRoleId) {
    return;
  }

  const ownerCount = await prisma.orgMembership.count({
    where: {
      orgId,
      roleId: ownerRoleId,
    },
  });

  if (ownerCount <= 1) {
    throw new HttpError(409, "LAST_OWNER", "Cannot remove the last Owner");
  }
}

function userRoleForOrgRoleName(roleName: string): UserRole {
  // Legacy compatibility: many UI/API checks still use User.role.
  if (roleName === SYSTEM_ROLE_NAMES.OWNER || roleName === SYSTEM_ROLE_NAMES.ADMIN) {
    return UserRole.ADMIN;
  }
  return UserRole.EMPLOYEE;
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireSession(request);
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_ROLE_CHANGE
    );

    const { id: targetUserId } = params;
    const payload = patchSchema.parse(await request.json());

    const currentMembership = await prisma.orgMembership.findUnique({
      where: {
        orgId_userId: {
          orgId: membership.orgId,
          userId: targetUserId,
        },
      },
      include: { role: { select: { id: true, name: true } } },
    });

    if (!currentMembership) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const nextRole = await prisma.orgRole.findFirst({
      where: {
        orgId: membership.orgId,
        ...(payload.roleId ? { id: payload.roleId } : { name: payload.roleName! }),
      },
      select: { id: true, name: true },
    });

    if (!nextRole) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    const ownerRoleId = await getOwnerRoleId(membership.orgId);
    if (ownerRoleId && currentMembership.roleId === ownerRoleId && nextRole.id !== ownerRoleId) {
      await assertNotLastOwner(membership.orgId, ownerRoleId, targetUserId);
    }

    await prisma.orgMembership.update({
      where: { id: currentMembership.id },
      data: { roleId: nextRole.id },
    });

    await prisma.user.updateMany({
      where: { id: targetUserId, orgId: membership.orgId },
      data: { role: userRoleForOrgRoleName(nextRole.name) },
    });

    await logAudit({
      action: "USER_UPDATED",
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "user",
      targetId: targetUserId,
      metadata: { roleChanged: true, from: currentMembership.role.name, to: nextRole.name },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireSession(request);
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_USER_MANAGE
    );

    const { id: targetUserId } = params;

    const currentMembership = await prisma.orgMembership.findUnique({
      where: {
        orgId_userId: {
          orgId: membership.orgId,
          userId: targetUserId,
        },
      },
      include: { role: { select: { name: true } } },
    });

    if (!currentMembership) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const ownerRoleId = await getOwnerRoleId(membership.orgId);
    if (ownerRoleId) {
      await assertNotLastOwner(membership.orgId, ownerRoleId, targetUserId);
    }

    await prisma.$transaction(async (tx) => {
      await tx.orgMembership.delete({ where: { id: currentMembership.id } });

      await tx.user.updateMany({
        where: { id: targetUserId, orgId: membership.orgId },
        data: { orgId: null, role: UserRole.USER },
      });
    });

    await logAudit({
      action: "USER_UPDATED",
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "user",
      targetId: targetUserId,
      metadata: { removedFromOrg: true },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
