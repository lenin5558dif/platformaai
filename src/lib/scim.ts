import crypto from "crypto";
import { prisma } from "@/lib/db";

export function hashScimToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateScimToken() {
  return `scim_${crypto.randomBytes(24).toString("hex")}`;
}

export async function validateScimRequest(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/Bearer\s+(\S+)/i);
  if (!match) return null;

  const token = match[1];
  const tokenPrefix = token.slice(0, 8);
  const tokenHash = hashScimToken(token);

  const record = await prisma.scimToken.findFirst({
    where: { tokenPrefix },
    select: { id: true, tokenHash: true, orgId: true },
  });

  if (!record || record.tokenHash !== tokenHash) {
    return null;
  }

  await prisma.scimToken.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() },
  });

  return { orgId: record.orgId, tokenId: record.id };
}
