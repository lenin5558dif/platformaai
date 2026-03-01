import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { z } from "zod";
import { findUsablePasswordResetToken } from "@/lib/admin-password-reset";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";

const schema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8).max(72),
    confirmPassword: z.string().min(8).max(72),
  })
  .superRefine((value, ctx) => {
    if (value.password !== value.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "Passwords do not match",
      });
    }
  });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "VALIDATION_ERROR",
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  const token = parsed.data.token.trim();
  const resetToken = await findUsablePasswordResetToken(token);
  if (!resetToken) {
    return NextResponse.json(
      { error: "TOKEN_INVALID_OR_EXPIRED" },
      { status: 410 }
    );
  }

  const passwordHash = await hash(parsed.data.password, 12);
  const revokedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: resetToken.userId },
      data: {
        passwordHash,
        isActive: true,
        sessionInvalidatedAt: revokedAt,
        globalRevokeCounter: { increment: 1 },
      },
      select: { id: true },
    });

    await tx.session.deleteMany({
      where: { userId: resetToken.userId },
    });

    await tx.adminPasswordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: revokedAt },
    });
  });

  await logAudit({
    action: "ADMIN_PASSWORD_RESET_COMPLETED",
    orgId: resetToken.user.orgId ?? null,
    actorId: resetToken.requestedById ?? null,
    targetType: "user",
    targetId: resetToken.userId,
    metadata: {
      tokenPrefix: resetToken.tokenPrefix,
      byAdmin: Boolean(resetToken.requestedById),
    },
  });

  return NextResponse.json({ ok: true });
}
