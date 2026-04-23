import { beforeEach, describe, expect, test, vi } from "vitest";

const fetchWithTimeout = vi.hoisted(() => vi.fn());

vi.mock("@/lib/fetch-timeout", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/fetch-timeout")>(
    "../src/lib/fetch-timeout"
  );
  return {
    ...actual,
    fetchWithTimeout,
  };
});

vi.mock("@/lib/openrouter", () => ({
  getOpenRouterBaseUrl: vi.fn(() => "https://openrouter.test/api/v1"),
  getOpenRouterHeaders: vi.fn((apiKey: string) => ({
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  })),
}));

describe("image generation provider", () => {
  beforeEach(() => {
    fetchWithTimeout.mockReset();
  });

  test("sends image-only payload and parses generated images", async () => {
    fetchWithTimeout.mockResolvedValue(
      Response.json({
        id: "gen_1",
        choices: [
          {
            message: {
              content: "Готово",
              images: [
                {
                  image_url: {
                    url: "data:image/png;base64,aGVsbG8=",
                  },
                },
              ],
            },
          },
        ],
      })
    );

    const { generateImageWithOpenRouter } = await import(
      "../src/lib/image-generation-provider"
    );
    const result = await generateImageWithOpenRouter({
      apiKey: "key-1",
      modelId: "black-forest-labs/flux.2-klein-4b",
      prompt: "Нарисуй город",
      outputModalities: ["image"],
      aspectRatio: "16:9",
      imageSize: "1K",
    });

    const [, request] = fetchWithTimeout.mock.calls[0];
    expect(JSON.parse(request.body)).toMatchObject({
      model: "black-forest-labs/flux.2-klein-4b",
      messages: [{ role: "user", content: "Нарисуй город" }],
      modalities: ["image"],
      image_config: {
        aspect_ratio: "16:9",
        image_size: "1K",
      },
    });
    expect(result).toMatchObject({
      id: "gen_1",
      content: "Готово",
      images: [{ dataUrl: "data:image/png;base64,aGVsbG8=", index: 0 }],
    });
  });

  test("uses image and text modalities when model supports text output", async () => {
    fetchWithTimeout.mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              images: [{ imageUrl: { url: "data:image/webp;base64,aW1hZ2U=" } }],
            },
          },
        ],
      })
    );

    const { generateImageWithOpenRouter } = await import(
      "../src/lib/image-generation-provider"
    );
    await generateImageWithOpenRouter({
      apiKey: "key-1",
      modelId: "google/gemini-3.1-flash-image-preview",
      prompt: "Generate",
      outputModalities: ["text", "image"],
    });

    const [, request] = fetchWithTimeout.mock.calls[0];
    expect(JSON.parse(request.body).modalities).toEqual(["image", "text"]);
  });

  test("throws when provider returns no images", async () => {
    fetchWithTimeout.mockResolvedValue(
      Response.json({ choices: [{ message: { content: "No image" } }] })
    );

    const { generateImageWithOpenRouter } = await import(
      "../src/lib/image-generation-provider"
    );
    await expect(
      generateImageWithOpenRouter({
        apiKey: "key-1",
        modelId: "model",
        prompt: "Generate",
      })
    ).rejects.toThrow("did not include images");
  });

  test("surfaces OpenRouter errors", async () => {
    fetchWithTimeout.mockResolvedValue(
      new Response("bad model", {
        status: 400,
      })
    );

    const { generateImageWithOpenRouter } = await import(
      "../src/lib/image-generation-provider"
    );
    await expect(
      generateImageWithOpenRouter({
        apiKey: "key-1",
        modelId: "model",
        prompt: "Generate",
      })
    ).rejects.toThrow("bad model");
  });
});
