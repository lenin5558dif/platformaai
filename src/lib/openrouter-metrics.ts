type HeaderCarrier = {
  get(name: string): string | null;
};

function parseHeaderNumber(value: string | null) {
  if (!value) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function readFirstNumber(headers: HeaderCarrier | null | undefined, names: string[]) {
  if (!headers) return null;
  for (const name of names) {
    const value = parseHeaderNumber(headers.get(name));
    if (value !== null) return value;
  }
  return null;
}

export function getOpenRouterRateLimitPayload(
  headers: HeaderCarrier | null | undefined
) {
  const limit = readFirstNumber(headers, [
    "x-ratelimit-limit",
    "ratelimit-limit",
  ]);
  const remaining = readFirstNumber(headers, [
    "x-ratelimit-remaining",
    "ratelimit-remaining",
  ]);
  const reset = readFirstNumber(headers, [
    "x-ratelimit-reset",
    "ratelimit-reset",
  ]);

  return {
    ...(limit !== null ? { rateLimitLimit: limit } : {}),
    ...(remaining !== null ? { rateLimitRemaining: remaining } : {}),
    ...(reset !== null ? { rateLimitReset: reset } : {}),
  };
}
