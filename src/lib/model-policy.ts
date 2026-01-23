import type { OrgModelPolicy } from "@/lib/org-settings";

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export function isModelAllowed(modelId: string, policy: OrgModelPolicy) {
  if (!policy.models.length) return true;
  const list = policy.models.map(normalize);
  const target = normalize(modelId);
  if (policy.mode === "allowlist") {
    return list.includes(target);
  }
  return !list.includes(target);
}

export function filterModels<T extends { id: string }>(
  models: T[],
  policy: OrgModelPolicy
) {
  if (!policy.models.length) return models;
  const list = new Set(policy.models.map(normalize));
  if (policy.mode === "allowlist") {
    return models.filter((model) => list.has(normalize(model.id)));
  }
  return models.filter((model) => !list.has(normalize(model.id)));
}
