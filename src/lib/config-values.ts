const PLACEHOLDER_VALUES = new Set([
  "replace_me",
  "replace-me",
  "replace_with_real_value",
  "replace-with-real-value",
  "replace-with-a-long-random-secret",
  "replace-with-your-openrouter-key",
  "replace-with-your-unisender-key",
  "sk_test_replace_me",
  "whsec_replace_me",
]);

export function hasRealConfiguredValue(value?: string | null) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().replace(/^['"]|['"]$/g, "").toLowerCase();
  if (!normalized) {
    return false;
  }

  if (PLACEHOLDER_VALUES.has(normalized)) {
    return false;
  }

  if (normalized.includes("replace_me") || normalized.includes("replace-with")) {
    return false;
  }

  return true;
}
