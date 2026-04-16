import crypto from "crypto";
import { prisma } from "@/lib/db";

const EMAIL_VERIFICATION_TOKEN_BYTES = 32;
const DEFAULT_EMAIL_VERIFICATION_TTL_MINUTES = 60 * 24;
const EMAIL_VERIFICATION_PREFIX = "email-verify";

function buildIdentifier(userId: string, email: string) {
  return `${EMAIL_VERIFICATION_PREFIX}:${userId}:${email.toLowerCase()}`;
}

function parseIdentifier(identifier: string) {
  const [prefix, userId, ...emailParts] = identifier.split(":");
  if (prefix !== EMAIL_VERIFICATION_PREFIX || !userId || emailParts.length === 0) {
    return null;
  }

  return {
    userId,
    email: emailParts.join(":"),
  };
}

export function generateEmailVerificationToken() {
  return crypto.randomBytes(EMAIL_VERIFICATION_TOKEN_BYTES).toString("hex");
}

export function buildEmailVerificationUrl(token: string) {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000";
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${normalizedBase}/api/auth/email/verify?token=${encodeURIComponent(token)}`;
}

export async function issueEmailVerificationToken(params: {
  userId: string;
  email: string;
  ttlMinutes?: number;
}) {
  const token = generateEmailVerificationToken();
  const identifier = buildIdentifier(params.userId, params.email);
  const ttlMinutes =
    params.ttlMinutes ?? DEFAULT_EMAIL_VERIFICATION_TTL_MINUTES;
  const expires = new Date(Date.now() + ttlMinutes * 60 * 1000);

  await prisma.verificationToken.deleteMany({
    where: {
      identifier: {
        startsWith: `${EMAIL_VERIFICATION_PREFIX}:${params.userId}:`,
      },
    },
  });

  await prisma.verificationToken.create({
    data: {
      identifier,
      token,
      expires,
    },
  });

  return {
    token,
    expires,
    verificationUrl: buildEmailVerificationUrl(token),
  };
}

export async function consumeEmailVerificationToken(token: string) {
  const record = await prisma.verificationToken.findUnique({
    where: { token },
  });

  if (!record) {
    return { ok: false as const, reason: "TOKEN_INVALID" };
  }

  if (record.expires <= new Date()) {
    await prisma.verificationToken.delete({ where: { token } });
    return { ok: false as const, reason: "TOKEN_EXPIRED" };
  }

  const parsed = parseIdentifier(record.identifier);
  if (!parsed) {
    await prisma.verificationToken.delete({ where: { token } });
    return { ok: false as const, reason: "TOKEN_INVALID" };
  }

  const user = await prisma.user.findUnique({
    where: { id: parsed.userId },
    select: { id: true, email: true },
  });

  if (!user || user.email?.toLowerCase() !== parsed.email) {
    await prisma.verificationToken.delete({ where: { token } });
    return { ok: false as const, reason: "TOKEN_INVALID" };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedByProvider: true },
    }),
    prisma.verificationToken.delete({ where: { token } }),
  ]);

  return {
    ok: true as const,
    userId: user.id,
    email: user.email,
  };
}
