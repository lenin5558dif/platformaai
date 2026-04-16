import { getModelPricing } from "@/lib/models";
import { DEFAULT_BILLING_MARKUP } from "@/lib/billing-display";

const DEFAULT_USD_PER_CREDIT = 0.01;
const DEFAULT_STT_USD_PER_MINUTE = 0.006;

export async function calculateCreditsFromUsage(params: {
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  apiKey?: string;
}) {
  const pricing = await getModelPricing(params.modelId, params.apiKey);

  const promptPrice = pricing?.prompt ? Number(pricing.prompt) : 0;
  const completionPrice = pricing?.completion ? Number(pricing.completion) : 0;

  const promptUsd = params.promptTokens * promptPrice;
  const completionUsd = params.completionTokens * completionPrice;

  const markup = Number(
    process.env.OPENROUTER_MARKUP ?? DEFAULT_BILLING_MARKUP
  );
  const usdPerCredit = Number(
    process.env.USD_PER_CREDIT ?? DEFAULT_USD_PER_CREDIT
  );

  const totalUsd = (promptUsd + completionUsd) * markup;
  const credits = usdPerCredit > 0 ? totalUsd / usdPerCredit : totalUsd * 100;

  return {
    credits,
    totalUsd,
    promptUsd,
    completionUsd,
  };
}

export function calculateCreditsFromStt(params: { durationSeconds: number }) {
  const usdPerMinute = Number(
    process.env.WHISPER_USD_PER_MINUTE ?? DEFAULT_STT_USD_PER_MINUTE
  );
  const markup = Number(
    process.env.OPENROUTER_MARKUP ?? DEFAULT_BILLING_MARKUP
  );
  const usdPerCredit = Number(
    process.env.USD_PER_CREDIT ?? DEFAULT_USD_PER_CREDIT
  );

  const totalUsd = (params.durationSeconds / 60) * usdPerMinute * markup;
  const credits = usdPerCredit > 0 ? totalUsd / usdPerCredit : totalUsd * 100;

  return { credits, totalUsd };
}
