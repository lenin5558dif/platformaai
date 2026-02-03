type RateEntry = {
  count: number;
  resetAt: number;
};

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: number;
};

const globalStore = globalThis as unknown as {
  rateLimitStore?: Map<string, RateEntry>;
};

const store = globalStore.rateLimitStore ?? new Map<string, RateEntry>();
if (!globalStore.rateLimitStore) {
  globalStore.rateLimitStore = store;
}

export function checkRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
}): RateLimitResult {
  const now = Date.now();
  const entry = store.get(params.key);

  if (!entry || entry.resetAt <= now) {
    store.set(params.key, { count: 1, resetAt: now + params.windowMs });
    return { ok: true, remaining: params.limit - 1, resetAt: now + params.windowMs };
  }

  if (entry.count >= params.limit) {
    return { ok: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  store.set(params.key, entry);
  return { ok: true, remaining: params.limit - entry.count, resetAt: entry.resetAt };
}

export function getRateLimitHeaders(params: {
  limit: number;
  remaining: number;
  resetAt: number;
}) {
  const resetSeconds = Math.ceil(params.resetAt / 1000);
  return {
    "X-RateLimit-Limit": String(params.limit),
    "X-RateLimit-Remaining": String(params.remaining),
    "X-RateLimit-Reset": String(resetSeconds),
  };
}

export function getRetryAfterHeader(resetAt: number, nowMs = Date.now()) {
  const seconds = Math.max(0, Math.ceil((resetAt - nowMs) / 1000));
  return { "Retry-After": String(seconds) };
}
