import { upstashCommand, upstashPipeline } from "@/lib/upstash-redis";

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

function checkRateLimitInMemory(params: {
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

function toFiniteNumber(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

async function checkRateLimitInRedis(params: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<RateLimitResult | undefined> {
  const redisKey = `rl:${params.key}`;
  const result = await upstashPipeline([
    ["INCR", redisKey],
    ["PEXPIRE", redisKey, params.windowMs, "NX"],
    ["PTTL", redisKey],
  ]);

  if (!result) {
    return undefined;
  }

  const count = toFiniteNumber(result[0]);
  let ttlMs = toFiniteNumber(result[2]);

  if (!count || count < 1) {
    throw new Error("Redis rate-limit returned invalid counter");
  }

  if (ttlMs === null || ttlMs <= 0) {
    await upstashCommand(["PEXPIRE", redisKey, params.windowMs]);
    ttlMs = params.windowMs;
  }

  const resetAt = Date.now() + ttlMs;
  const remaining = Math.max(0, params.limit - count);

  if (count > params.limit) {
    return { ok: false, remaining: 0, resetAt };
  }

  return { ok: true, remaining, resetAt };
}

export async function checkRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<RateLimitResult> {
  try {
    const redisResult = await checkRateLimitInRedis(params);
    if (redisResult) {
      return redisResult;
    }
  } catch {
    // Fallback to process-local limiter if Redis is unavailable.
  }

  return checkRateLimitInMemory(params);
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
