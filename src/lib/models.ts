import { getOpenRouterBaseUrl, getOpenRouterHeaders } from "@/lib/openrouter";

export type OpenRouterModel = {
  id: string;
  name: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
};

type ModelsCache = {
  data: OpenRouterModel[];
  fetchedAt: number;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
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

  const response = await fetch(`${getOpenRouterBaseUrl()}/models`, {
    headers: getOpenRouterHeaders(apiKey),
    cache: "no-store",
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
