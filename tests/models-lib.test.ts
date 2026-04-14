import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { fetchModels, getModelPricing } from "@/lib/models";
import { filterModels, isModelAllowed } from "@/lib/model-policy";
import { getOpenRouterBaseUrl, getOpenRouterHeaders } from "@/lib/openrouter";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

function resetOpenRouterCache() {
  delete (globalThis as typeof globalThis & {
    openRouterModels?: unknown;
    openRouterModelsByKey?: unknown;
  }).openRouterModels;
  delete (globalThis as typeof globalThis & {
    openRouterModels?: unknown;
    openRouterModelsByKey?: unknown;
  }).openRouterModelsByKey;
}

describe("models lib", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      OPENROUTER_API_KEY: "env-key",
      OPENROUTER_BASE_URL: "https://openrouter.example/api/v1",
      OPENROUTER_SITE_URL: "https://app.example.com",
      OPENROUTER_APP_NAME: "PlatformaAI",
    };
    resetOpenRouterCache();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    globalThis.fetch = ORIGINAL_FETCH;
    resetOpenRouterCache();
  });

  test("caches anonymous model lists within the TTL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "openai/gpt-4o-mini", name: "GPT-4o mini" }],
        }),
        { status: 200 }
      )
    );
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const first = await fetchModels();
    const second = await fetchModels();

    expect(first).toEqual([
      { id: "openai/gpt-4o-mini", name: "GPT-4o mini" },
    ]);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.example/api/v1/models",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: "Bearer env-key",
          "HTTP-Referer": "https://app.example.com",
          "X-Title": "PlatformaAI",
          "Content-Type": "application/json",
        }),
      })
    );
  });

  test("keeps apiKey-specific caches separate and feeds getModelPricing", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const headers = (init as RequestInit | undefined)?.headers as
        | Record<string, string>
        | undefined;
      const auth = headers?.Authorization ?? "";

      if (auth.includes("key-one")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "openai/gpt-4o-mini",
                name: "GPT-4o mini",
                pricing: { prompt: "0.000001", completion: "0.000002" },
              },
            ],
          }),
          { status: 200 }
        );
      }

      return new Response(
        JSON.stringify({
          data: [{ id: "anthropic/claude-3-opus", name: "Claude 3 Opus" }],
        }),
        { status: 200 }
      );
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const first = await fetchModels({ apiKey: "key-one" });
    const second = await fetchModels({ apiKey: "key-one" });
    const other = await fetchModels({ apiKey: "key-two" });
    const pricing = await getModelPricing("openai/gpt-4o-mini", "key-one");
    const missingPricing = await getModelPricing("missing-model", "key-one");

    expect(first).toEqual([
      {
        id: "openai/gpt-4o-mini",
        name: "GPT-4o mini",
        pricing: { prompt: "0.000001", completion: "0.000002" },
      },
    ]);
    expect(second).toBe(first);
    expect(other).toEqual([
      { id: "anthropic/claude-3-opus", name: "Claude 3 Opus" },
    ]);
    expect(pricing).toEqual({ prompt: "0.000001", completion: "0.000002" });
    expect(missingPricing).toBeNull();
    expect(await getModelPricing("anthropic/claude-3-opus", "key-two")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer key-one",
        }),
      })
    );
    expect(fetchMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer key-two",
        }),
      })
    );
  });

  test("forces a refresh when requested", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          data: [{ id: "openai/gpt-4o-mini", name: "GPT-4o mini" }],
        }),
        { status: 200 }
      );
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    await fetchModels();
    await fetchModels({ force: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("throws a descriptive error when the OpenRouter response is not ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("missing key", { status: 401 })
    );
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    await expect(fetchModels()).rejects.toThrow(
      "OpenRouter models error: missing key"
    );
  });

  test("covers OpenRouter helpers and model policy branches", () => {
    expect(getOpenRouterBaseUrl()).toBe("https://openrouter.example/api/v1");

    delete process.env.OPENROUTER_BASE_URL;
    expect(getOpenRouterBaseUrl()).toBe("https://openrouter.ai/api/v1");

    expect(getOpenRouterHeaders("override-key")).toEqual({
      Authorization: "Bearer override-key",
      "HTTP-Referer": "https://app.example.com",
      "X-Title": "PlatformaAI",
      "Content-Type": "application/json",
    });

    delete process.env.OPENROUTER_SITE_URL;
    delete process.env.OPENROUTER_APP_NAME;
    expect(getOpenRouterHeaders("override-key")).toEqual({
      Authorization: "Bearer override-key",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "PlatformaAI",
      "Content-Type": "application/json",
    });

    delete process.env.OPENROUTER_API_KEY;
    expect(() => getOpenRouterHeaders()).toThrow(
      "OPENROUTER_API_KEY is not set"
    );

    expect(isModelAllowed("OpenAI/GPT-4o-Mini", {
      mode: "allowlist",
      models: ["openai/gpt-4o-mini"],
    })).toBe(true);
    expect(isModelAllowed("anthropic/claude-3-opus", {
      mode: "denylist",
      models: ["anthropic/claude-3-opus"],
    })).toBe(false);
    expect(isModelAllowed("any/model", {
      mode: "denylist",
      models: [],
    })).toBe(true);

    expect(
      filterModels(
        [
          { id: "openai/gpt-4o-mini", name: "GPT-4o mini" },
          { id: "anthropic/claude-3-opus", name: "Claude 3 Opus" },
        ],
        { mode: "allowlist", models: ["openai/gpt-4o-mini"] }
      )
    ).toEqual([{ id: "openai/gpt-4o-mini", name: "GPT-4o mini" }]);
    expect(
      filterModels(
        [
          { id: "openai/gpt-4o-mini", name: "GPT-4o mini" },
          { id: "anthropic/claude-3-opus", name: "Claude 3 Opus" },
        ],
        { mode: "denylist", models: ["anthropic/claude-3-opus"] }
      )
    ).toEqual([{ id: "openai/gpt-4o-mini", name: "GPT-4o mini" }]);
    expect(
      filterModels(
        [{ id: "openai/gpt-4o-mini", name: "GPT-4o mini" }],
        { mode: "denylist", models: [] }
      )
    ).toEqual([{ id: "openai/gpt-4o-mini", name: "GPT-4o mini" }]);
  });
});
