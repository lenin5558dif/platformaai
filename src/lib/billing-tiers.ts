import type { Prisma } from "@prisma/client";
import { getSettingsObject } from "@/lib/user-settings";

export const BILLING_TIER_IDS = [
  "free",
  "tier_500",
  "tier_1500",
  "tier_5000",
] as const;

export type BillingTier = (typeof BILLING_TIER_IDS)[number];

export type BillingTierConfig = {
  id: BillingTier;
  label: string;
  priceRub: number;
  includedCredits: number;
  isPaid: boolean;
};

export const BILLING_TIERS: Record<BillingTier, BillingTierConfig> = {
  free: {
    id: "free",
    label: "Free",
    priceRub: 0,
    includedCredits: 0,
    isPaid: false,
  },
  tier_500: {
    id: "tier_500",
    label: "500 ₽",
    priceRub: 500,
    includedCredits: 500,
    isPaid: true,
  },
  tier_1500: {
    id: "tier_1500",
    label: "1500 ₽",
    priceRub: 1500,
    includedCredits: 1500,
    isPaid: true,
  },
  tier_5000: {
    id: "tier_5000",
    label: "5000 ₽",
    priceRub: 5000,
    includedCredits: 5000,
    isPaid: true,
  },
};

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isBillingTierId(value: string): value is BillingTier {
  return (BILLING_TIER_IDS as readonly string[]).includes(value);
}

function mapLegacyPlanName(planName: string): BillingTier | null {
  const normalized = normalize(planName);

  if (!normalized) return null;
  if (normalized === "free") return "free";
  if (normalized.includes("5000") || normalized.includes("5 000")) {
    return "tier_5000";
  }
  if (normalized.includes("1500") || normalized.includes("1 500")) {
    return "tier_1500";
  }
  if (normalized.includes("500")) {
    return "tier_500";
  }
  if (normalized.includes("pro") || normalized.includes("paid")) {
    return "tier_500";
  }
  return null;
}

export function getBillingTierLabel(tier: BillingTier) {
  return BILLING_TIERS[tier].label;
}

export function getBillingTierPriceRub(tier: BillingTier) {
  return BILLING_TIERS[tier].priceRub;
}

export function getBillingTierIncludedCredits(tier: BillingTier) {
  return BILLING_TIERS[tier].includedCredits;
}

export function isFreeBillingTier(tier: BillingTier) {
  return tier === "free";
}

export function isPaidBillingTier(tier: BillingTier) {
  return BILLING_TIERS[tier].isPaid;
}

export function getBillingTierOptions() {
  return BILLING_TIER_IDS.map((id) => BILLING_TIERS[id]);
}

export function getPaidBillingTierOptions() {
  return getBillingTierOptions().filter((tier) => tier.isPaid);
}

export function getBillingTier(
  settings: Prisma.JsonValue | null | undefined,
  balance?: unknown
): BillingTier {
  const data = getSettingsObject(settings ?? null);
  const explicit = data.billingTier;
  if (typeof explicit === "string" && isBillingTierId(explicit)) {
    return explicit;
  }

  const legacyPlanName = data.planName;
  if (typeof legacyPlanName === "string") {
    const mapped = mapLegacyPlanName(legacyPlanName);
    if (mapped) return mapped;
  }

  return getBillingTierFromBalance(balance);
}

export function getBillingTierLabelFromSettings(
  settings: Prisma.JsonValue | null | undefined,
  balance?: unknown
) {
  return getBillingTierLabel(getBillingTier(settings, balance));
}

export function getBillingTierFromBalance(balance?: unknown): BillingTier {
  const numericBalance = Number(balance ?? 0);
  return numericBalance > 0 ? "tier_500" : "free";
}
