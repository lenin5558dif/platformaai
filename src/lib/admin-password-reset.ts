import crypto from "crypto";
import { prisma } from "@/lib/db";

const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_PREFIX_CHARS = 8;
const DEFAULT_RESET_TOKEN_TTL_MINUTES = 60;

export function hashPasswordResetToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function passwordResetTokenPrefix(token: string) {
  return token.slice(0, RESET_TOKEN_PREFIX_CHARS);
}

export function generatePasswordResetToken() {
  return crypto.randomBytes(RESET_TOKEN_BYTES).toString("hex");
}

export function buildPasswordResetUrl(token: string) {
  const base =
    process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${normalizedBase}/reset-password?token=${encodeURIComponent(token)}`;
}

export async function issueAdminPasswordResetToken(params: {
  userId: string;
  requestedById?: string | null;
  ttlMinutes?: number;
}) {
  const token = generatePasswordResetToken();
  const tokenHash = hashPasswordResetToken(token);
  const tokenPrefix = passwordResetTokenPrefix(token);
  const ttlMinutes = params.ttlMinutes ?? DEFAULT_RESET_TOKEN_TTL_MINUTES;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  await prisma.adminPasswordResetToken.create({
    data: {
      userId: params.userId,
      requestedById: params.requestedById ?? null,
      tokenHash,
      tokenPrefix,
      expiresAt,
    },
  });

  return {
    token,
    tokenPrefix,
    tokenHash,
    expiresAt,
    resetUrl: buildPasswordResetUrl(token),
  };
}

export async function findUsablePasswordResetToken(token: string) {
  const tokenHash = hashPasswordResetToken(token);
  return prisma.adminPasswordResetToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          orgId: true,
        },
      },
    },
  });
}

export async function markPasswordResetTokenUsed(id: string) {
  return prisma.adminPasswordResetToken.update({
    where: { id },
    data: { usedAt: new Date() },
  });
}
