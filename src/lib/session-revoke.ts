import { prisma } from "@/lib/db";

export async function revokeAllSessionsForUser(userId: string) {
  const revokedAt = new Date();

  const deletedSessions = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        sessionInvalidatedAt: revokedAt,
        globalRevokeCounter: { increment: 1 },
      },
      select: { id: true },
    });

    const deleted = await tx.session.deleteMany({ where: { userId } });
    return deleted.count;
  });

  return { revokedAt, deletedSessions };
}
