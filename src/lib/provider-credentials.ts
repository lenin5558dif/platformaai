import type { ProviderType } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  decryptSecret,
  encryptSecret,
  secretFingerprint,
} from "@/lib/secret-crypto";

export async function getOrgProviderCredential(params: {
  orgId: string;
  provider: ProviderType;
}) {
  if (!("orgProviderCredential" in prisma) || !prisma.orgProviderCredential) {
    return null;
  }

  return prisma.orgProviderCredential.findUnique({
    where: {
      orgId_provider: {
        orgId: params.orgId,
        provider: params.provider,
      },
    },
    select: {
      id: true,
      orgId: true,
      provider: true,
      secretFingerprint: true,
      isActive: true,
      updatedAt: true,
      updatedById: true,
      encryptedSecret: true,
    },
  });
}

export async function upsertOrgProviderCredential(params: {
  orgId: string;
  provider: ProviderType;
  rawSecret: string;
  isActive: boolean;
  updatedById?: string | null;
}) {
  if (!("orgProviderCredential" in prisma) || !prisma.orgProviderCredential) {
    throw new Error("Org provider credentials are unavailable");
  }

  const normalized = params.rawSecret
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/\s+/g, "");

  if (!normalized) {
    throw new Error("Provider secret is empty");
  }

  return prisma.orgProviderCredential.upsert({
    where: {
      orgId_provider: {
        orgId: params.orgId,
        provider: params.provider,
      },
    },
    update: {
      encryptedSecret: encryptSecret(normalized),
      secretFingerprint: secretFingerprint(normalized),
      isActive: params.isActive,
      updatedById: params.updatedById ?? null,
    },
    create: {
      orgId: params.orgId,
      provider: params.provider,
      encryptedSecret: encryptSecret(normalized),
      secretFingerprint: secretFingerprint(normalized),
      isActive: params.isActive,
      updatedById: params.updatedById ?? null,
    },
  });
}

export async function resolveProviderSecret(params: {
  orgId?: string | null;
  provider: ProviderType;
}) {
  if (!params.orgId) return null;
  const record = await getOrgProviderCredential({
    orgId: params.orgId,
    provider: params.provider,
  });
  if (!record || !record.isActive) return null;

  try {
    return decryptSecret(record.encryptedSecret);
  } catch {
    return null;
  }
}

export async function resolveOpenRouterApiKey(params: { orgId?: string | null }) {
  const OPENROUTER_PROVIDER = "OPENROUTER" as ProviderType;
  const orgSecret = await resolveProviderSecret({
    orgId: params.orgId,
    provider: OPENROUTER_PROVIDER,
  });
  if (orgSecret) return orgSecret;
  return process.env.OPENROUTER_API_KEY ?? null;
}
