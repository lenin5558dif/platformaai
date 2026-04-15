import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getOpenRouterBaseUrl, getOpenRouterHeaders } from "../src/lib/openrouter";
import { searchWeb } from "../src/lib/search";

describe("openrouter and search utilities", () => {
  beforeEach(() => {
    delete process.env.OPENROUTER_BASE_URL;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_SITE_URL;
    delete process.env.OPENROUTER_APP_NAME;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("openrouter helpers read env and override values", () => {
    expect(getOpenRouterBaseUrl()).toBe("https://openrouter.ai/api/v1");

    process.env.OPENROUTER_BASE_URL = "https://example.invalid/api";
    expect(getOpenRouterBaseUrl()).toBe("https://example.invalid/api");

    expect(() => getOpenRouterHeaders()).toThrow("OPENROUTER_API_KEY is not set");

    process.env.OPENROUTER_API_KEY = "env-secret";
    process.env.OPENROUTER_SITE_URL = "https://app.example";
    process.env.OPENROUTER_APP_NAME = "Custom App";

    expect(getOpenRouterHeaders()).toEqual({
      Authorization: "Bearer env-secret",
      "HTTP-Referer": "https://app.example",
      "X-Title": "Custom App",
      "Content-Type": "application/json",
    });
    delete process.env.OPENROUTER_SITE_URL;
    delete process.env.OPENROUTER_APP_NAME;
    expect(getOpenRouterHeaders("override-secret")).toEqual({
      Authorization: "Bearer override-secret",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "PlatformaAI",
      "Content-Type": "application/json",
    });
  });

  test("searchWeb parses results from DuckDuckGo HTML", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => `
        <div class="result">
          <a class="result__a" href="https://example.com/one">First result</a>
          <a class="result__snippet">Snippet one</a>
        </div>
        <div class="result">
          <a class="result__a" href="https://example.com/two">Second result</a>
          <a class="result__snippet">Snippet two</a>
        </div>
      `,
    } as Response);

    const results = await searchWeb("openrouter summary", 1);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://duckduckgo.com/html/?q=openrouter%20summary",
      expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": expect.stringContaining("Mozilla/5.0"),
        }),
      }),
    );
    expect(results).toEqual([
      {
        title: "First result",
        url: "https://example.com/one",
        snippet: "Snippet one",
      },
    ]);
  });
});
