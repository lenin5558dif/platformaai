import { createHash } from "node:crypto";

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
const globalCache = globalThis as unknown as {
  aiResponseCache?: Map<string, CacheEntry>;
};

function getCacheStore() {
  if (!globalCache.aiResponseCache) {
    globalCache.aiResponseCache = new Map<string, CacheEntry>();
  }
  return globalCache.aiResponseCache;
}

export function buildCacheKey(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function getCachedResponse(key: string) {
  const store = getCacheStore();
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    store.delete(key);
    return null;
  }
  return entry;
}

export function setCachedResponse(key: string, entry: CacheEntry) {
  const store = getCacheStore();
  store.set(key, entry);
}
