import { describe, expect, it } from "vitest";
import {
  getBillingTier,
  getBillingTierFromBalance,
  getBillingTierIncludedCredits,
  getBillingTierLabel,
  getBillingTierLabelFromSettings,
  getBillingTierOptions,
  getPaidBillingTierOptions,
  getBillingTierPriceRub,
  isPaidBillingTier,
  isFreeBillingTier,
} from "@/lib/billing-tiers";

describe("billing tiers", () => {
  it("falls back to free for empty settings", () => {
    expect(getBillingTier(null)).toBe("free");
    expect(isFreeBillingTier(getBillingTier(null))).toBe(true);
  });

  it("maps legacy plan names to fixed tiers", () => {
    expect(getBillingTier({ planName: "Тариф Pro" } as any, 10)).toBe("tier_500");
    expect(getBillingTier({ planName: " paid " } as any)).toBe("tier_500");
    expect(getBillingTier({ planName: "1 500 рублей" } as any)).toBe("tier_1500");
    expect(getBillingTier({ planName: "5000" } as any)).toBe("tier_5000");
  });

  it("prefers explicit billing tier over legacy settings", () => {
    expect(
      getBillingTier({ billingTier: "tier_1500", planName: "5000" } as any)
    ).toBe("tier_1500");
    expect(
      getBillingTierLabelFromSettings({ billingTier: "tier_5000" } as any)
    ).toBe("5000 ₽");
  });

  it("returns labels, prices and credits for fixed tiers", () => {
    expect(getBillingTierLabel("tier_1500")).toBe("1500 ₽");
    expect(getBillingTierPriceRub("tier_500")).toBe(500);
    expect(getBillingTierIncludedCredits("tier_5000")).toBe(5000);
    expect(isPaidBillingTier("tier_500")).toBe(true);
    expect(isFreeBillingTier("free")).toBe(true);
  });

  it("provides options and balance fallback", () => {
    expect(getBillingTierFromBalance(0)).toBe("free");
    expect(getBillingTierFromBalance(100)).toBe("tier_500");
    expect(getBillingTier({ billingTier: "broken" } as any, 0)).toBe("free");
    expect(getBillingTier({ planName: "" } as any, 200)).toBe("tier_500");
    expect(getBillingTier({ planName: "unknown" } as any, 0)).toBe("free");
    expect(getBillingTierOptions()).toHaveLength(4);
    expect(getPaidBillingTierOptions().map((item) => item.id)).toEqual([
      "tier_500",
      "tier_1500",
      "tier_5000",
    ]);
  });
});
