import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { getOpenRouterBaseUrl, getOpenRouterHeaders } from "@/lib/openrouter";

export type OpenRouterImageModel = {
  id: string;
  name: string;
  input_modalities?: string[];
  output_modalities?: string[];
  pricing?: Record<string, string | undefined>;
};

type ImageModelsCache = {
  data: OpenRouterImageModel[];
  fetchedAt: number;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const OPENROUTER_IMAGE_MODELS_TIMEOUT_MS = 12_000;

const globalCache = globalThis as unknown as {
  openRouterImageModels?: ImageModelsCache;
  openRouterImageModelsByKey?: Map<string, ImageModelsCache>;
};

function hasFreeModelSuffix(modelId: string) {
  return modelId.toLowerCase().endsWith(":free");
}

function parsePricingValue(value?: string) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isImageGenerationModel(model: Pick<OpenRouterImageModel, "output_modalities">) {
  return model.output_modalities?.some((modality) => modality.toLowerCase() === "image") ?? false;
}

export function isFreeImageModel(model: Pick<OpenRouterImageModel, "id" | "pricing">) {
  if (hasFreeModelSuffix(model.id)) return true;

  const pricingValues = Object.values(model.pricing ?? {})
    .map(parsePricingValue)
    .filter((value): value is number => value !== null);

  if (pricingValues.length === 0) return false;

  // OpenRouter uses -1 for router/unknown pricing, so free means exactly zero.
  return pricingValues.every((value) => value === 0);
}

export function filterFreeImageModels(models: OpenRouterImageModel[]) {
  return models.filter((model) => isImageGenerationModel(model) && isFreeImageModel(model));
}

export async function fetchImageModels(params?: {
  force?: boolean;
  apiKey?: string;
}) {
  const force = params?.force ?? false;
  const apiKey = params?.apiKey;
  let cached: ImageModelsCache | undefined;

  if (apiKey) {
    if (!globalCache.openRouterImageModelsByKey) {
      globalCache.openRouterImageModelsByKey = new Map<string, ImageModelsCache>();
    }
    cached = globalCache.openRouterImageModelsByKey.get(apiKey);
  } else {
    cached = globalCache.openRouterImageModels;
  }

  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const response = await fetchWithTimeout(
    `${getOpenRouterBaseUrl()}/models?output_modalities=image`,
    {
      headers: getOpenRouterHeaders(apiKey),
      cache: "no-store",
      timeoutMs: OPENROUTER_IMAGE_MODELS_TIMEOUT_MS,
      timeoutLabel: "OpenRouter image models",
    }
  );

  if (!response.ok) {
    throw new Error(`OpenRouter image models error: ${await response.text()}`);
  }

  const payload = await response.json();
  const data = ((payload?.data ?? []) as OpenRouterImageModel[]).filter(isImageGenerationModel);
  const entry = { data, fetchedAt: Date.now() };

  if (apiKey) {
    globalCache.openRouterImageModelsByKey?.set(apiKey, entry);
  } else {
    globalCache.openRouterImageModels = entry;
  }

  return data;
}

export async function getImageModelById(modelId: string, apiKey?: string) {
  const models = await fetchImageModels({ apiKey });
  return models.find((model) => model.id === modelId) ?? null;
}
