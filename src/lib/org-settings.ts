import { Prisma } from "@prisma/client";

export type OrgModelPolicy = {
  mode: "allowlist" | "denylist";
  models: string[];
};

export type OrgDlpPolicy = {
  enabled: boolean;
  action: "block" | "redact";
  patterns: string[];
};

export function getOrgSettingsObject(settings: Prisma.JsonValue | null) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {} as Record<string, unknown>;
  }
  return settings as Record<string, unknown>;
}

export function getOrgModelPolicy(settings: Prisma.JsonValue | null): OrgModelPolicy {
  const data = getOrgSettingsObject(settings);
  const policy = data.modelPolicy;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return { mode: "denylist", models: [] };
  }
  const policyRecord = policy as Record<string, unknown>;
  const mode = policyRecord.mode === "allowlist" ? "allowlist" : "denylist";
  const models = Array.isArray(policyRecord.models)
    ? policyRecord.models.filter(
        (item): item is string => typeof item === "string"
      )
    : [];
  return { mode, models };
}

export function getOrgDlpPolicy(settings: Prisma.JsonValue | null): OrgDlpPolicy {
  const data = getOrgSettingsObject(settings);
  const policy = data.dlpPolicy;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return { enabled: false, action: "block", patterns: [] };
  }
  const policyRecord = policy as Record<string, unknown>;
  const enabled = policyRecord.enabled === true;
  const action = policyRecord.action === "redact" ? "redact" : "block";
  const patterns = Array.isArray(policyRecord.patterns)
    ? policyRecord.patterns.filter(
        (item): item is string => typeof item === "string"
      )
    : [];
  return { enabled, action, patterns };
}

export function mergeOrgSettings(
  settings: Prisma.JsonValue | null,
  patch: Record<string, unknown>
) {
  return { ...getOrgSettingsObject(settings), ...patch } as Prisma.InputJsonValue;
}
