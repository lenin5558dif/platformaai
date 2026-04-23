import { DEFAULT_BILLING_MARKUP } from "@/lib/billing-display";
import type { OpenRouterImageModel } from "@/lib/image-models";

const DEFAULT_USD_PER_CREDIT = 0.01;

function envNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pricingNumber(value?: string) {
  if (typeof value !== "string" || !value.trim()) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function calculateCreditsFromImageModel(model: Pick<OpenRouterImageModel, "pricing">) {
  const pricing = model.pricing ?? {};
  const imageUsd = pricingNumber(pricing.image);
  const promptUsd = pricingNumber(pricing.prompt);
  const completionUsd = pricingNumber(pricing.completion);
  const requestUsd = pricingNumber(pricing.request);

  // Image models usually expose a per-image price. If not, keep a conservative
  // lower-bound from available positive pricing fields instead of guessing tokens.
  const baseUsd = imageUsd || requestUsd || promptUsd + completionUsd;
  const markup = envNumber("OPENROUTER_MARKUP", DEFAULT_BILLING_MARKUP);
  const usdPerCredit = envNumber("USD_PER_CREDIT", DEFAULT_USD_PER_CREDIT);
  const totalUsd = baseUsd * markup;
  const credits = usdPerCredit > 0 ? totalUsd / usdPerCredit : totalUsd * 100;

  return {
    credits,
    totalUsd,
    imageUsd,
    promptUsd,
    completionUsd,
    requestUsd,
  };
}
