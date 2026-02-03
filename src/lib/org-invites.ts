import crypto from "crypto";
import { generateToken } from "@/lib/tokens";

const INVITE_TOKEN_BYTES = 32;
const INVITE_TOKEN_PREFIX_CHARS = 8;

export function normalizeInviteEmail(email: string) {
  return email.trim().toLowerCase();
}

export function hashInviteToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function inviteTokenPrefix(token: string) {
  return token.slice(0, INVITE_TOKEN_PREFIX_CHARS);
}

export function generateInviteToken() {
  const token = generateToken(INVITE_TOKEN_BYTES);
  return {
    token,
    tokenPrefix: inviteTokenPrefix(token),
    tokenHash: hashInviteToken(token),
  };
}

export function tokenHashesEqual(aHex: string, bHex: string) {
  if (aHex.length !== bHex.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(aHex, "hex"),
      Buffer.from(bHex, "hex")
    );
  } catch {
    return false;
  }
}

export function buildInviteAcceptUrl(token: string) {
  const base =
    process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${normalizedBase}/invite/accept?token=${encodeURIComponent(token)}`;
}
