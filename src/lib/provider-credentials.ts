import { ProviderType, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  decryptSecret,
  encryptSecret,
  maskSecretByFingerprint,
  secretFingerprint,
} from "@/lib/secret-crypto";
import { getSettingsObject } from "@/lib/user-settings";

const USER_OPENROUTER_SETTINGS_KEY = "personalOpenRouterCredential";

function parseUserOpenRouterCredential(
  settings: Prisma.JsonValue
): {
  encryptedSecret: string;
  secretFingerprint: string;
  isActive: boolean;
  updatedAt: string | null;
} | null {
  const data = getSettingsObject(settings);
  const raw = data[USER_OPENROUTER_SETTINGS_KEY];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const encryptedSecret =
    typeof record.encryptedSecret === "string" ? record.encryptedSecret : "";
  const secretFingerprint =
    typeof record.secretFingerprint === "string" ? record.secretFingerprint : "";
  const updatedAt =
    typeof record.updatedAt === "string" ? record.updatedAt : null;
  const isActive =
    typeof record.isActive === "boolean" ? record.isActive : true;

  if (!encryptedSecret || !secretFingerprint) {
    return null;
  }

  return {
    encryptedSecret,
    secretFingerprint,
    isActive,
    updatedAt,
  };
}

function buildUserOpenRouterCredentialPatch(params: {
  existingSettings: Prisma.JsonValue;
  encryptedSecret: string;
  secretFingerprint: string;
  isActive: boolean;
}) {
  const data = getSettingsObject(params.existingSettings);
  return {
    ...data,
    [USER_OPENROUTER_SETTINGS_KEY]: {
      encryptedSecret: params.encryptedSecret,
      secretFingerprint: params.secretFingerprint,
      isActive: params.isActive,
      updatedAt: new Date().toISOString(),
    },
  } as Prisma.InputJsonValue;
}

export async function getOrgProviderCredential(params: {
  orgId: string;
  provider: ProviderType;
}) {
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

export async function getUserOpenRouterCredential(params: { userId: string }) {
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { settings: true },
  });

  const parsed = parseUserOpenRouterCredential(user?.settings ?? null);
  if (!parsed) {
    return null;
  }

  return {
    provider: ProviderType.OPENROUTER,
    isActive: parsed.isActive,
    secretFingerprint: parsed.secretFingerprint,
    updatedAt: parsed.updatedAt,
    maskedFingerprint: maskSecretByFingerprint(parsed.secretFingerprint),
  };
}

export async function upsertUserOpenRouterCredential(params: {
  userId: string;
  rawSecret: string;
  isActive: boolean;
}) {
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { settings: true },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const normalized = params.rawSecret
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/\s+/g, "");
  const existing = parseUserOpenRouterCredential(user.settings);

  if (!normalized && !existing) {
    throw new Error("Provider secret is empty");
  }

  const encryptedSecret = normalized
    ? encryptSecret(normalized)
    : existing?.encryptedSecret ?? "";
  const fingerprint = normalized
    ? secretFingerprint(normalized)
    : existing?.secretFingerprint ?? "";

  await prisma.user.update({
    where: { id: params.userId },
    data: {
      settings: buildUserOpenRouterCredentialPatch({
        existingSettings: user.settings,
        encryptedSecret,
        secretFingerprint: fingerprint,
        isActive: params.isActive,
      }),
    },
  });
}

export async function resolveUserOpenRouterApiKey(params: { userId?: string | null }) {
  if (!params.userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { settings: true },
  });
  const record = parseUserOpenRouterCredential(user?.settings ?? null);

  if (!record || !record.isActive) {
    return null;
  }

  try {
    return decryptSecret(record.encryptedSecret);
  } catch {
    return null;
  }
}

export async function upsertOrgProviderCredential(params: {
  orgId: string;
  provider: ProviderType;
  rawSecret: string;
  isActive: boolean;
  updatedById?: string | null;
}) {
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

export async function resolveOpenRouterApiKey(params: {
  userId?: string | null;
  orgId?: string | null;
}) {
  const userSecret = await resolveUserOpenRouterApiKey({
    userId: params.userId,
  });
  if (userSecret) return userSecret;

  const orgSecret = await resolveProviderSecret({
    orgId: params.orgId,
    provider: ProviderType.OPENROUTER,
  });
  if (orgSecret) return orgSecret;
  return process.env.OPENROUTER_API_KEY ?? null;
}
