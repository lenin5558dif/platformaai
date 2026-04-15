type CreditValue = number | null;

export type BillingPlanId = "starter" | "creator" | "pro";

export type BillingPlan = {
  id: BillingPlanId;
  name: string;
  audience: "B2C";
  monthlyPriceUsd: number;
  yearlyDiscountPercent: number;
  includedCreditsPerMonth: CreditValue;
  topUpAllowed: boolean;
  renewalEnabled: boolean;
  badge?: string;
  description: string;
  features: string[];
};

export type ResolvedPlan = {
  id: BillingPlanId | null;
  name: string;
  monthlyPriceUsd: number | null;
  includedCreditsPerMonth: CreditValue;
  topUpAllowed: boolean;
  renewalEnabled: boolean;
  description: string | null;
  features: string[];
  isCustom: boolean;
};

type DecimalLike = number | { toString(): string } | null | undefined;

type SubscriptionPlanSnapshot = {
  code?: string | null;
  name?: string | null;
  monthlyPriceUsd?: DecimalLike;
  includedCreditsPerMonth?: DecimalLike;
} | null;

type SubscriptionSnapshot = {
  plan?: SubscriptionPlanSnapshot;
} | null | undefined;

const DEFAULT_USD_PER_CREDIT = 0.01;

function envNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function monthlyCreditsFromPrice(monthlyPriceUsd: number): number {
  const usdPerCredit = envNumber("USD_PER_CREDIT", DEFAULT_USD_PER_CREDIT);
  return Math.round(monthlyPriceUsd / usdPerCredit);
}

export const BILLING_PLANS: BillingPlan[] = [
  {
    id: "starter",
    name: "Старт",
    audience: "B2C",
    monthlyPriceUsd: 0,
    yearlyDiscountPercent: 20,
    includedCreditsPerMonth: 0,
    topUpAllowed: true,
    renewalEnabled: false,
    badge: "Бесплатно",
    description: "Для знакомства с платформой и базовых сценариев.",
    features: [
      "Llama 3, Mistral 7B",
      "50 запросов в день",
      "Стандартная скорость",
      "Можно докупать дополнительные кредиты",
    ],
  },
  {
    id: "creator",
    name: "Креатор",
    audience: "B2C",
    monthlyPriceUsd: 29,
    yearlyDiscountPercent: 20,
    includedCreditsPerMonth: monthlyCreditsFromPrice(29),
    topUpAllowed: true,
    renewalEnabled: true,
    badge: "Популярный выбор",
    description: "Для профессиональной работы с лучшими моделями и включенным лимитом на месяц.",
    features: [
      "Все из тарифа «Старт»",
      `Включено ${monthlyCreditsFromPrice(29).toLocaleString("ru-RU")} кредитов в месяц`,
      "GPT-4o, Claude 3.5 Sonnet",
      "Приоритетная очередь",
      "Можно докупать кредиты сверх лимита",
    ],
  },
  {
    id: "pro",
    name: "Профи",
    audience: "B2C",
    monthlyPriceUsd: 99,
    yearlyDiscountPercent: 20,
    includedCreditsPerMonth: monthlyCreditsFromPrice(99),
    topUpAllowed: true,
    renewalEnabled: true,
    badge: "Максимум",
    description: "Для команд и power users с максимальным включенным лимитом и приоритетом.",
    features: [
      "Все из тарифа «Креатор»",
      `Включено ${monthlyCreditsFromPrice(99).toLocaleString("ru-RU")} кредитов в месяц`,
      "Максимальная скорость",
      "Приватные данные (Zero-retention)",
      "Приоритетная поддержка 24/7",
    ],
  },
];

const PLAN_BY_ID = new Map(BILLING_PLANS.map((plan) => [plan.id, plan]));
const LEGACY_PLAN_NAME_TO_ID = new Map<string, BillingPlanId>([
  ["старт", "starter"],
  ["starter", "starter"],
  ["креатор", "creator"],
  ["creator", "creator"],
  ["omni pro", "pro"],
  ["pro plan", "pro"],
  ["план pro", "pro"],
  ["power user", "pro"],
  ["профи", "pro"],
]);

function asSettingsObject(settings: unknown): Record<string, unknown> {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {};
  }

  return settings as Record<string, unknown>;
}

function readString(settings: Record<string, unknown>, key: string): string | null {
  const value = settings[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(settings: Record<string, unknown>, key: string): number | null {
  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function decimalToNumber(value: DecimalLike): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value) return null;

  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

export function getBillingPlan(planId: BillingPlanId | null | undefined) {
  return planId ? PLAN_BY_ID.get(planId) ?? null : null;
}

type BillingPlanPersistence = {
  billingPlan: {
    upsert: (args: {
      where: { code: string };
      update: {
        name: string;
        monthlyPriceUsd: number;
        includedCreditsPerMonth: number;
        stripePriceId: string | null;
        isActive: boolean;
      };
      create: {
        code: string;
        name: string;
        monthlyPriceUsd: number;
        includedCreditsPerMonth: number;
        stripePriceId: string | null;
        isActive: boolean;
      };
    }) => Promise<unknown>;
  };
};

const PLAN_STRIPE_PRICE_ENV: Record<Exclude<BillingPlanId, "starter">, string> = {
  creator: "STRIPE_PRICE_ID_CREATOR",
  pro: "STRIPE_PRICE_ID_PRO",
};

export function getPlanStripePriceId(
  planId: BillingPlanId | null | undefined,
  fallback?: string | null
) {
  if (!planId || planId === "starter") {
    return fallback ?? null;
  }

  return process.env[PLAN_STRIPE_PRICE_ENV[planId]] ?? fallback ?? null;
}

export async function ensureBillingPlans(prisma: BillingPlanPersistence) {
  await Promise.all(
    BILLING_PLANS.map((plan) => {
      const stripePriceId = getPlanStripePriceId(plan.id, null);

      return prisma.billingPlan.upsert({
        where: { code: plan.id },
        update: {
          name: plan.name,
          monthlyPriceUsd: plan.monthlyPriceUsd,
          includedCreditsPerMonth: plan.includedCreditsPerMonth ?? 0,
          stripePriceId,
          isActive: true,
        },
        create: {
          code: plan.id,
          name: plan.name,
          monthlyPriceUsd: plan.monthlyPriceUsd,
          includedCreditsPerMonth: plan.includedCreditsPerMonth ?? 0,
          stripePriceId,
          isActive: true,
        },
      });
    })
  );
}

export function resolveBillingPlanId(value: unknown): BillingPlanId | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim().toLowerCase();

  if (PLAN_BY_ID.has(normalized as BillingPlanId)) {
    return normalized as BillingPlanId;
  }

  return LEGACY_PLAN_NAME_TO_ID.get(normalized) ?? null;
}

export function resolvePlanFromSettings(settings: unknown): ResolvedPlan | null {
  const data = asSettingsObject(settings);
  const explicitPlanId = resolveBillingPlanId(readString(data, "planId"));
  const legacyPlanId = resolveBillingPlanId(readString(data, "planName"));
  const plan = getBillingPlan(explicitPlanId ?? legacyPlanId);

  if (plan) {
    return {
      id: plan.id,
      name: plan.name,
      monthlyPriceUsd: plan.monthlyPriceUsd,
      includedCreditsPerMonth: plan.includedCreditsPerMonth,
      topUpAllowed: plan.topUpAllowed,
      renewalEnabled: plan.renewalEnabled,
      description: plan.description,
      features: plan.features,
      isCustom: false,
    };
  }

  const customName = readString(data, "planName");
  if (!customName) return null;

  return {
    id: null,
    name: customName,
    monthlyPriceUsd: readNumber(data, "planPrice"),
    includedCreditsPerMonth: readNumber(data, "includedCreditsPerMonth"),
    topUpAllowed: true,
    renewalEnabled: true,
    description: null,
    features: [],
    isCustom: true,
  };
}

export function resolvePlanFromSubscription(subscription: SubscriptionSnapshot): ResolvedPlan | null {
  const plan = subscription?.plan;
  if (!plan?.name) {
    return null;
  }

  const planId = resolveBillingPlanId(plan.code);
  const staticPlan = getBillingPlan(planId);

  if (staticPlan) {
    return {
      id: staticPlan.id,
      name: plan.name,
      monthlyPriceUsd: decimalToNumber(plan.monthlyPriceUsd) ?? staticPlan.monthlyPriceUsd,
      includedCreditsPerMonth:
        decimalToNumber(plan.includedCreditsPerMonth) ?? staticPlan.includedCreditsPerMonth,
      topUpAllowed: staticPlan.topUpAllowed,
      renewalEnabled: staticPlan.renewalEnabled,
      description: staticPlan.description,
      features: staticPlan.features,
      isCustom: false,
    };
  }

  return {
    id: null,
    name: plan.name,
    monthlyPriceUsd: decimalToNumber(plan.monthlyPriceUsd),
    includedCreditsPerMonth: decimalToNumber(plan.includedCreditsPerMonth),
    topUpAllowed: true,
    renewalEnabled: true,
    description: null,
    features: [],
    isCustom: true,
  };
}

export function getPlanLabel(settings: unknown, fallback = "Тариф не назначен") {
  return resolvePlanFromSettings(settings)?.name ?? fallback;
}
