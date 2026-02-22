import * as cheerio from "cheerio";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

const SEARCH_TIMEOUT_MS = 8_000;

export async function searchWeb(query: string, limit = 5) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    },
    timeoutMs: SEARCH_TIMEOUT_MS,
    timeoutLabel: "DuckDuckGo search",
  });

  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];

  $(".result").each((_, element) => {
    if (results.length >= limit) return;
    const title = $(element).find(".result__a").text().trim();
    const url = $(element).find(".result__a").attr("href")?.trim() ?? "";
    const snippet = $(element).find(".result__snippet").text().trim();

    if (title && url) {
      results.push({ title, url, snippet });
    }
  });

  return results;
}
