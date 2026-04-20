import type { PrismaClient, UserRole } from "@prisma/client";
import { logAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";

type AdminUserRoleDeps = Pick<PrismaClient, "user">;

export async function setUserAdminRoleByAdmin(params: {
  prisma: AdminUserRoleDeps;
  actorId: string;
  userId: string;
  nextRole: UserRole;
}) {
  if (params.nextRole !== "ADMIN" && params.nextRole !== "USER") {
    throw new HttpError(400, "ROLE_NOT_ALLOWED", "Only USER or ADMIN role is allowed");
  }

  if (params.actorId === params.userId && params.nextRole !== "ADMIN") {
    throw new HttpError(400, "CANNOT_DEMOTE_SELF", "Admin cannot remove their own admin role");
  }

  const user = await params.prisma.user.findUnique({
    where: { id: params.userId },
    select: {
      id: true,
      email: true,
      role: true,
      orgId: true,
    },
  });

  if (!user) {
    throw new HttpError(404, "NOT_FOUND", "User not found");
  }

  if (user.role === params.nextRole) {
    return user;
  }

  const updatedUser = await params.prisma.user.update({
    where: { id: user.id },
    data: { role: params.nextRole },
    select: {
      id: true,
      email: true,
      role: true,
      orgId: true,
    },
  });

  await logAudit({
    action: "USER_UPDATED",
    orgId: user.orgId ?? null,
    actorId: params.actorId,
    targetType: "user",
    targetId: user.id,
    metadata: {
      adminSection: "clients",
      roleChanged: true,
      previousRole: user.role,
      nextRole: updatedUser.role,
      email: user.email ?? null,
    },
  });

  return updatedUser;
}
