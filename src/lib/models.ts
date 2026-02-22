import { getOpenRouterBaseUrl, getOpenRouterHeaders } from "@/lib/openrouter";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

export type OpenRouterModel = {
  id: string;
  name: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
};

function hasFreeModelSuffix(modelId: string) {
  return modelId.toLowerCase().endsWith(":free");
}

function parsePricingValue(value?: string) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isOpenRouterModelFree(
  model: Pick<OpenRouterModel, "id" | "pricing">
) {
  if (hasFreeModelSuffix(model.id)) return true;

  const prompt = parsePricingValue(model.pricing?.prompt);
  const completion = parsePricingValue(model.pricing?.completion);

  if (prompt === null && completion === null) {
    return false;
  }

  return (prompt ?? 0) <= 0 && (completion ?? 0) <= 0;
}

export function filterFreeOpenRouterModels(models: OpenRouterModel[]) {
  return models.filter(isOpenRouterModelFree);
}

type ModelsCache = {
  data: OpenRouterModel[];
  fetchedAt: number;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const OPENROUTER_MODELS_TIMEOUT_MS = 12_000;
const globalCache = globalThis as unknown as {
  openRouterModels?: ModelsCache;
  openRouterModelsByKey?: Map<string, ModelsCache>;
};

export async function fetchModels(params?: {
  force?: boolean;
  apiKey?: string;
}) {
  const force = params?.force ?? false;
  const apiKey = params?.apiKey;
  let cached: ModelsCache | undefined;

  if (apiKey) {
    if (!globalCache.openRouterModelsByKey) {
      globalCache.openRouterModelsByKey = new Map<string, ModelsCache>();
    }
    cached = globalCache.openRouterModelsByKey.get(apiKey);
  } else {
    cached = globalCache.openRouterModels;
  }

  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const response = await fetchWithTimeout(`${getOpenRouterBaseUrl()}/models`, {
    headers: getOpenRouterHeaders(apiKey),
    cache: "no-store",
    timeoutMs: OPENROUTER_MODELS_TIMEOUT_MS,
    timeoutLabel: "OpenRouter models",
  });

  if (!response.ok) {
    throw new Error(`OpenRouter models error: ${await response.text()}`);
  }

  const payload = await response.json();
  const data = (payload?.data ?? []) as OpenRouterModel[];

  const entry = { data, fetchedAt: Date.now() };

  if (apiKey) {
    globalCache.openRouterModelsByKey?.set(apiKey, entry);
  } else {
    globalCache.openRouterModels = entry;
  }

  return data;
}

export async function getModelPricing(modelId: string, apiKey?: string) {
  const models = await fetchModels({ apiKey });
  const model = models.find((entry) => entry.id === modelId);

  return model?.pricing ?? null;
}

export async function filterFreeOpenRouterModelIds(
  modelIds: string[],
  apiKey?: string
) {
  if (!modelIds.length) return [];

  const models = await fetchModels({ apiKey });
  const freeModelIds = new Set(
    filterFreeOpenRouterModels(models).map((model) => model.id)
  );

  return modelIds.filter(
    (modelId) => freeModelIds.has(modelId) || hasFreeModelSuffix(modelId)
  );
}
