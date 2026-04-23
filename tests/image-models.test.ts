import { beforeEach, describe, expect, test, vi } from "vitest";

const fetchWithTimeout = vi.hoisted(() => vi.fn());

vi.mock("@/lib/fetch-timeout", () => ({ fetchWithTimeout }));
vi.mock("@/lib/openrouter", () => ({
  getOpenRouterBaseUrl: vi.fn(() => "https://openrouter.test/api/v1"),
  getOpenRouterHeaders: vi.fn((apiKey?: string) => ({
    Authorization: `Bearer ${apiKey ?? "env-key"}`,
  })),
}));

describe("image models", () => {
  beforeEach(() => {
    fetchWithTimeout.mockReset();
    delete (globalThis as unknown as { openRouterImageModels?: unknown }).openRouterImageModels;
    delete (globalThis as unknown as { openRouterImageModelsByKey?: unknown })
      .openRouterImageModelsByKey;
    vi.resetModules();
  });

  test("filters image generation models from OpenRouter response", async () => {
    fetchWithTimeout.mockImplementation(async () =>
      Response.json({
        data: [
          {
            id: "image/free",
            name: "Free Image",
            architecture: {
              output_modalities: ["image"],
            },
            pricing: { prompt: "0", completion: "0" },
          },
          {
            id: "text/free",
            name: "Text Free",
            architecture: {
              output_modalities: ["text"],
            },
            pricing: { prompt: "0", completion: "0" },
          },
        ],
      })
    );

    const { fetchImageModels } = await import("../src/lib/image-models");
    const models = await fetchImageModels({ apiKey: "key-1" });

    expect(fetchWithTimeout).toHaveBeenCalledWith(
      "https://openrouter.test/api/v1/models?output_modalities=image",
      expect.objectContaining({
        headers: { Authorization: "Bearer key-1" },
        timeoutLabel: "OpenRouter image models",
      })
    );
    expect(models.map((model) => model.id)).toEqual(["image/free"]);
    expect(models[0]?.output_modalities).toEqual(["image"]);
  });

  test("filters free image models and excludes unknown negative router pricing", async () => {
    const { filterFreeImageModels } = await import("../src/lib/image-models");

    const models = filterFreeImageModels([
      {
        id: "sourceful/riverflow-v2-fast",
        name: "Riverflow",
        output_modalities: ["image"],
        pricing: { prompt: "0", completion: "0" },
      },
      {
        id: "openrouter/auto",
        name: "Auto",
        output_modalities: ["image"],
        pricing: { prompt: "-1", completion: "-1" },
      },
      {
        id: "paid/image",
        name: "Paid",
        output_modalities: ["image"],
        pricing: { prompt: "0.000001", completion: "0" },
      },
    ]);

    expect(models.map((model) => model.id)).toEqual(["sourceful/riverflow-v2-fast"]);
  });

  test("caches image models by api key", async () => {
    fetchWithTimeout.mockImplementation(async () =>
      Response.json({
        data: [
          {
            id: "image/free",
            name: "Free Image",
            output_modalities: ["image"],
            pricing: { prompt: "0", completion: "0" },
          },
        ],
      })
    );

    const { fetchImageModels } = await import("../src/lib/image-models");
    await fetchImageModels({ apiKey: "key-1" });
    await fetchImageModels({ apiKey: "key-1" });
    await fetchImageModels({ apiKey: "key-2" });

    expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
  });
});
