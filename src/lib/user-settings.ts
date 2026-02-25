import type { Prisma } from "@prisma/client";

export function getSettingsObject(settings: Prisma.JsonValue) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {} as Record<string, unknown>;
  }

  return settings as Record<string, unknown>;
}

export function getUserOpenRouterKey(settings: Prisma.JsonValue) {
  const data = getSettingsObject(settings);
  const value = data.openrouterApiKey;
  if (typeof value !== "string") return undefined;
  const normalized = value
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/\s+/g, "");
  return normalized || undefined;
}

export function getUserProfile(settings: Prisma.JsonValue) {
  const data = getSettingsObject(settings);
  const value = data.userProfile;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function getUserAssistantInstructions(settings: Prisma.JsonValue) {
  const data = getSettingsObject(settings);
  const value = data.assistantInstructions;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function getUserGoal(settings: Prisma.JsonValue) {
  const data = getSettingsObject(settings);
  const value = data.userGoal;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function getUserTone(settings: Prisma.JsonValue) {
  const data = getSettingsObject(settings);
  const value = data.userTone;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function mergeSettings(
  settings: Prisma.JsonValue,
  patch: Record<string, unknown>
): Prisma.InputJsonValue {
  return { ...getSettingsObject(settings), ...patch } as Prisma.InputJsonValue;
}

export function removeSettingsKey(
  settings: Prisma.JsonValue,
  key: string
): Prisma.InputJsonValue {
  const next = { ...getSettingsObject(settings) };
  delete next[key];
  return next as Prisma.InputJsonValue;
}
