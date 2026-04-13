import { prisma } from "@/lib/db";

export type PlatformConfigSnapshot = {
  id: string;
  globalSystemPrompt: string | null;
  disabledModelIds: string[];
  updatedAt: Date;
  updatedById: string | null;
};

function normalizeModelIds(modelIds: string[]) {
  return Array.from(
    new Set(
      modelIds
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
    )
  );
}

export async function getPlatformConfig() {
  return prisma.platformConfig.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      globalSystemPrompt: null,
      disabledModelIds: [],
    },
    select: {
      id: true,
      globalSystemPrompt: true,
      disabledModelIds: true,
      updatedAt: true,
      updatedById: true,
    },
  }) as Promise<PlatformConfigSnapshot>;
}

export async function updatePlatformConfig(params: {
  globalSystemPrompt?: string | null;
  disabledModelIds?: string[];
  updatedById?: string | null;
}) {
  const existing = await getPlatformConfig();

  const nextPrompt =
    params.globalSystemPrompt === undefined
      ? existing.globalSystemPrompt
      : params.globalSystemPrompt?.trim() || null;
  const nextDisabled =
    params.disabledModelIds === undefined
      ? existing.disabledModelIds
      : normalizeModelIds(params.disabledModelIds);

  return prisma.platformConfig.upsert({
    where: { id: "default" },
    update: {
      globalSystemPrompt: nextPrompt,
      disabledModelIds: nextDisabled,
      updatedById: params.updatedById ?? null,
    },
    create: {
      id: "default",
      globalSystemPrompt: nextPrompt,
      disabledModelIds: nextDisabled,
      updatedById: params.updatedById ?? null,
    },
  });
}

export async function isModelGloballyDisabled(modelId: string) {
  const config = await getPlatformConfig();
  return config.disabledModelIds.includes(modelId);
}
