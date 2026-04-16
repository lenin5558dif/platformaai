export const ONBOARDING_REQUIRED_FIELDS = [
  "firstName",
  "lastName",
  "headline",
  "userGoal",
] as const;

export type OnboardingFieldKey = (typeof ONBOARDING_REQUIRED_FIELDS)[number];

export const ONBOARDING_FIELD_LABELS: Record<OnboardingFieldKey, string> = {
  firstName: "имя",
  lastName: "фамилия",
  headline: "чем вы занимаетесь",
  userGoal: "цель использования",
};

export function getMissingOnboardingFields(
  values: Record<OnboardingFieldKey, string>
) {
  return ONBOARDING_REQUIRED_FIELDS.filter((field) => {
    const value = values[field];
    return typeof value !== "string" || value.trim().length === 0;
  });
}

export function getOnboardingSummaryText(
  missingFields: OnboardingFieldKey[] = ONBOARDING_REQUIRED_FIELDS.slice()
) {
  const labels = missingFields.map((field) => ONBOARDING_FIELD_LABELS[field]);
  return labels.join(", ");
}
