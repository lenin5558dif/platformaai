export function getOpenRouterBaseUrl() {
  return process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
}

export function getOpenRouterHeaders(apiKeyOverride?: string) {
  const apiKey = apiKeyOverride ?? process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
    "X-Title": process.env.OPENROUTER_APP_NAME ?? "PlatformaAI",
    "Content-Type": "application/json",
  };
}
