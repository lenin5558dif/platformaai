import type { PrismaClient } from "@prisma/client";
import { logAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";

type DeleteUserDeps = Pick<
  PrismaClient,
  | "$transaction"
  | "user"
  | "organization"
  | "auditLog"
  | "orgInvite"
  | "dlpPolicy"
  | "modelPolicy"
  | "orgProviderCredential"
  | "platformConfig"
  | "adminPasswordResetToken"
  | "feedback"
  | "attachment"
  | "message"
  | "chat"
  | "transaction"
  | "telegramLinkToken"
  | "userChannel"
  | "account"
  | "session"
  | "prompt"
  | "verificationToken"
  | "orgMembership"
>;

export async function deleteUserByAdmin(params: {
  prisma: DeleteUserDeps;
  actorId: string;
  userId: string;
}) {
  if (params.actorId === params.userId) {
    throw new HttpError(400, "CANNOT_DELETE_SELF", "Admin cannot delete themselves");
  }

  const user = await params.prisma.user.findUnique({
    where: { id: params.userId },
    select: {
      id: true,
      email: true,
      telegramId: true,
      orgId: true,
    },
  });

  if (!user) {
    throw new HttpError(404, "NOT_FOUND", "User not found");
  }

  const ownedOrg = await params.prisma.organization.findFirst({
    where: { ownerId: user.id },
    select: { id: true },
  });

  if (ownedOrg) {
    throw new HttpError(
      400,
      "ORG_OWNER_DELETE_FORBIDDEN",
      "Delete or transfer owned organization before deleting the user"
    );
  }

  await params.prisma.$transaction(async (tx) => {
    await tx.auditLog.updateMany({
      where: { actorId: user.id },
      data: { actorId: null },
    });
    await tx.orgInvite.updateMany({
      where: { createdById: user.id },
      data: { createdById: null },
    });
    await tx.dlpPolicy.updateMany({
      where: { createdById: user.id },
      data: { createdById: null },
    });
    await tx.dlpPolicy.updateMany({
      where: { updatedById: user.id },
      data: { updatedById: null },
    });
    await tx.modelPolicy.updateMany({
      where: { createdById: user.id },
      data: { createdById: null },
    });
    await tx.modelPolicy.updateMany({
      where: { updatedById: user.id },
      data: { updatedById: null },
    });
    await tx.orgProviderCredential.updateMany({
      where: { updatedById: user.id },
      data: { updatedById: null },
    });
    await tx.platformConfig.updateMany({
      where: { updatedById: user.id },
      data: { updatedById: null },
    });

    await tx.adminPasswordResetToken.deleteMany({
      where: {
        OR: [{ requestedById: user.id }, { userId: user.id }],
      },
    });
    await tx.feedback.deleteMany({ where: { userId: user.id } });
    await tx.attachment.deleteMany({
      where: {
        OR: [{ userId: user.id }, { chat: { userId: user.id } }],
      },
    });
    await tx.message.deleteMany({
      where: {
        OR: [{ userId: user.id }, { chat: { userId: user.id } }],
      },
    });
    await tx.chat.deleteMany({ where: { userId: user.id } });
    await tx.transaction.deleteMany({ where: { userId: user.id } });
    await tx.telegramLinkToken.deleteMany({ where: { userId: user.id } });
    await tx.userChannel.deleteMany({ where: { userId: user.id } });
    await tx.account.deleteMany({ where: { userId: user.id } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.prompt.deleteMany({ where: { createdById: user.id } });
    await tx.verificationToken.deleteMany({
      where: {
        identifier: { startsWith: `email-verify:${user.id}:` },
      },
    });
    await tx.orgMembership.deleteMany({ where: { userId: user.id } });
    await tx.user.delete({ where: { id: user.id } });
  });

  await logAudit({
    action: "USER_DISABLED",
    orgId: user.orgId ?? null,
    actorId: params.actorId,
    targetType: "user",
    targetId: user.id,
    metadata: {
      adminSection: "clients",
      deleted: true,
      email: user.email ?? null,
      telegramId: user.telegramId ?? null,
    },
  });

  return user;
}
