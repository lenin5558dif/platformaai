export const DEFAULT_BILLING_MARKUP = 2;

export type ModelPricingLike = {
  prompt?: string;
  completion?: string;
};

function parseRate(value?: string) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPerMillionUsd(value: number) {
  const perMillion = value * 1_000_000;
  const decimals = perMillion < 1 ? 4 : perMillion < 10 ? 3 : 2;
  return `$${perMillion.toFixed(decimals)}/1M`;
}

export function formatCredits(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "0.00";
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) return "0.00";
  return num.toFixed(2);
}

export function formatCreditsLabel(value: string | number | null | undefined) {
  return `${formatCredits(value)} кредитов`;
}

export function formatSignedCredits(
  value: string | number | null | undefined,
  sign: "+" | "-" = "+"
) {
  return `${sign}${formatCredits(value)}`;
}

export function formatPricePerMillion(
  value?: string,
  markup = DEFAULT_BILLING_MARKUP
) {
  const rate = parseRate(value);
  if (rate === null) return "—";

  const markedUpRate = rate * markup;
  const rawLabel = formatPerMillionUsd(rate);
  if (markup <= 1) {
    return rawLabel;
  }

  return `${rawLabel} → ${formatPerMillionUsd(markedUpRate)}`;
}

export function formatModelPricing(
  pricing?: ModelPricingLike,
  markup = DEFAULT_BILLING_MARKUP
) {
  if (!pricing?.prompt && !pricing?.completion) return "—";

  return `Prompt ${formatPricePerMillion(pricing.prompt, markup)} · Completion ${formatPricePerMillion(
    pricing.completion,
    markup
  )}`;
}

export function applyMarkup(value: number, markup = DEFAULT_BILLING_MARKUP) {
  return value * markup;
}

export function formatTransactionDirection(type: "REFILL" | "SPEND") {
  return type === "REFILL" ? "Пополнение" : "Списание";
}
