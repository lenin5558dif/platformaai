import { createHash } from "node:crypto";
import { upstashCommand } from "@/lib/upstash-redis";

type CacheEntry = {
  content: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  modelId: string;
  createdAt: number;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_KEY_PREFIX = "ai:cache:";

/**
 * Process-local fallback cache used when Redis is not configured/unavailable.
 * Cache keys include userId to ensure user isolation.
 */
const globalCache = globalThis as unknown as {
  aiResponseCache?: Map<string, CacheEntry>;
};

function getCacheStore() {
  if (!globalCache.aiResponseCache) {
    globalCache.aiResponseCache = new Map<string, CacheEntry>();
  }
  return globalCache.aiResponseCache;
}

type CacheKeyPayload = {
  userId: string;
  model: string;
  messages: unknown;
  temperature?: number;
  max_tokens?: number;
};

export function buildCacheKey(payload: CacheKeyPayload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function getCachedResponseInMemory(key: string) {
  const store = getCacheStore();
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    store.delete(key);
    return null;
  }
  return entry;
}

function setCachedResponseInMemory(key: string, entry: CacheEntry) {
  const store = getCacheStore();
  store.set(key, entry);
}

function getRedisCacheKey(key: string) {
  return `${CACHE_KEY_PREFIX}${key}`;
}

function isCacheEntry(value: unknown): value is CacheEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<CacheEntry>;
  return (
    typeof entry.content === "string" &&
    typeof entry.modelId === "string" &&
    typeof entry.createdAt === "number"
  );
}

export async function getCachedResponse(key: string) {
  const redisKey = getRedisCacheKey(key);

  try {
    const raw = await upstashCommand(["GET", redisKey]);
    if (raw !== undefined) {
      if (raw === null) return null;
      if (typeof raw !== "string") return null;

      const parsed = JSON.parse(raw) as unknown;
      if (!isCacheEntry(parsed)) return null;

      if (Date.now() - parsed.createdAt > CACHE_TTL_MS) {
        return null;
      }

      return parsed;
    }
  } catch {
    // Fallback to process-local cache if Redis read fails.
  }

  return getCachedResponseInMemory(key);
}

export async function setCachedResponse(key: string, entry: CacheEntry) {
  const redisKey = getRedisCacheKey(key);

  try {
    const result = await upstashCommand([
      "SET",
      redisKey,
      JSON.stringify(entry),
      "PX",
      CACHE_TTL_MS,
    ]);

    if (result !== undefined) {
      return;
    }
  } catch {
    // Fallback to process-local cache if Redis write fails.
  }

  setCachedResponseInMemory(key, entry);
}
