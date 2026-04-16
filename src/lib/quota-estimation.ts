import { getModelPricing } from "@/lib/models";
import { DEFAULT_BILLING_MARKUP } from "@/lib/billing-display";

import { DEFAULT_MAX_TOKENS } from "@/lib/quota-manager";

function envNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function estimateTokensFromText(text: string): number {
  // Cheap heuristic used elsewhere in the codebase.
  return Math.ceil(text.length / 4);
}

export function estimateChatPromptTokens(messages: Array<{ content: unknown }>): number {
  const joined = messages
    .map((m) => {
      if (typeof m.content === "string") return m.content;
      try {
        return JSON.stringify(m.content);
      } catch {
        return "";
      }
    })
    .join("\n");

  return estimateTokensFromText(joined);
}

export async function estimateUpperBoundCredits(params: {
  modelId: string;
  promptTokensEstimate: number;
  maxTokens?: number;
  apiKey?: string;
}): Promise<number> {
  const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;

  const pricing = await getModelPricing(params.modelId, params.apiKey);
  const promptUsdPerToken = Number(pricing?.prompt ?? 0);
  const completionUsdPerToken = Number(pricing?.completion ?? 0);

  // Conservative upper bound: treat all tokens as the more expensive class.
  const totalTokens = params.promptTokensEstimate + maxTokens;
  const usdPerToken = Math.max(promptUsdPerToken, completionUsdPerToken);

  const openRouterMarkup = envNumber(
    "OPENROUTER_MARKUP",
    DEFAULT_BILLING_MARKUP
  );
  const usdPerCredit = envNumber("USD_PER_CREDIT", 0.01);

  const worstCaseUsd = totalTokens * usdPerToken * openRouterMarkup;
  return usdPerCredit > 0 ? worstCaseUsd / usdPerCredit : worstCaseUsd;
}
