import { fetchWithTimeout, isFetchTimeoutError } from "@/lib/fetch-timeout";
import { getOpenRouterBaseUrl, getOpenRouterHeaders } from "@/lib/openrouter";

const OPENROUTER_GENERATE_IMAGE_TIMEOUT_MS = 90_000;

export type ImageGenerationProviderImage = {
  dataUrl: string;
  index: number;
};

export type ImageGenerationProviderResult = {
  id?: string;
  content: string;
  images: ImageGenerationProviderImage[];
  raw: unknown;
};

type OpenRouterImageEntry = {
  image_url?: {
    url?: string;
  };
  imageUrl?: {
    url?: string;
  };
};

function resolveModalities(outputModalities?: string[]) {
  const normalized = new Set(outputModalities?.map((item) => item.toLowerCase()) ?? []);
  if (normalized.has("text")) return ["image", "text"];
  return ["image"];
}

function extractImages(message: { images?: OpenRouterImageEntry[] } | null | undefined) {
  return (message?.images ?? [])
    .map((image, index) => ({
      dataUrl: image.image_url?.url ?? image.imageUrl?.url ?? "",
      index,
    }))
    .filter((image) => image.dataUrl.startsWith("data:image/"));
}

export async function generateImageWithOpenRouter(params: {
  apiKey: string;
  modelId: string;
  prompt: string;
  outputModalities?: string[];
  aspectRatio?: string | null;
  imageSize?: string | null;
}) {
  const imageConfig: Record<string, string> = {};
  if (params.aspectRatio) imageConfig.aspect_ratio = params.aspectRatio;
  if (params.imageSize) imageConfig.image_size = params.imageSize;

  let response: Response;
  try {
    response = await fetchWithTimeout(`${getOpenRouterBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: getOpenRouterHeaders(params.apiKey),
      body: JSON.stringify({
        model: params.modelId,
        messages: [{ role: "user", content: params.prompt }],
        modalities: resolveModalities(params.outputModalities),
        stream: false,
        ...(Object.keys(imageConfig).length > 0 ? { image_config: imageConfig } : {}),
      }),
      timeoutMs: OPENROUTER_GENERATE_IMAGE_TIMEOUT_MS,
      timeoutLabel: "OpenRouter image generation",
    });
  } catch (error) {
    throw new Error(isFetchTimeoutError(error) ? "OpenRouter image generation timeout" : "OpenRouter image generation error");
  }

  if (!response.ok) {
    throw new Error(`OpenRouter image generation error: ${await response.text()}`);
  }

  const payload = await response.json();
  const message = payload?.choices?.[0]?.message ?? null;
  const images = extractImages(message);

  if (images.length === 0) {
    throw new Error("OpenRouter image generation response did not include images");
  }

  return {
    id: typeof payload?.id === "string" ? payload.id : undefined,
    content: typeof message?.content === "string" ? message.content : "",
    images,
    raw: payload,
  } satisfies ImageGenerationProviderResult;
}
