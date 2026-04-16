import { describe, expect, it } from "vitest";
import {
  getMissingOnboardingFields,
  getOnboardingSummaryText,
  ONBOARDING_REQUIRED_FIELDS,
} from "@/lib/onboarding";

describe("onboarding helpers", () => {
  it("returns all missing required fields", () => {
    expect(
      getMissingOnboardingFields({
        firstName: "",
        lastName: " ",
        headline: "",
        userGoal: "",
      })
    ).toEqual(ONBOARDING_REQUIRED_FIELDS);
  });

  it("returns only actually missing fields", () => {
    expect(
      getMissingOnboardingFields({
        firstName: "Nikolai",
        lastName: "Fomichev",
        headline: "",
        userGoal: "Рабочие задачи",
      })
    ).toEqual(["headline"]);
  });

  it("builds a readable summary text", () => {
    expect(getOnboardingSummaryText(["firstName", "userGoal"])).toBe(
      "имя, цель использования"
    );
  });
});
