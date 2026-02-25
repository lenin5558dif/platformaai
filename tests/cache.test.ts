import { describe, it, expect, beforeEach } from "vitest";
import {
  buildCacheKey,
  getCachedResponse,
  setCachedResponse,
} from "../src/lib/cache";

describe("cache", () => {
  describe("buildCacheKey", () => {
    it("should include userId in cache key", () => {
      const payload = {
        userId: "user-123",
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.7,
        max_tokens: 1000,
      };

      const key = buildCacheKey(payload);
      expect(key).toBeDefined();
      expect(typeof key).toBe("string");
      expect(key.length).toBe(64); // SHA-256 hex digest
    });

    it("should produce different keys for different users with same prompt", () => {
      const basePayload = {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.7,
        max_tokens: 1000,
      };

      const keyUserA = buildCacheKey({ ...basePayload, userId: "user-A" });
      const keyUserB = buildCacheKey({ ...basePayload, userId: "user-B" });

      expect(keyUserA).not.toBe(keyUserB);
    });

    it("should produce same key for same user with same prompt", () => {
      const payload = {
        userId: "user-123",
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.7,
        max_tokens: 1000,
      };

      const key1 = buildCacheKey(payload);
      const key2 = buildCacheKey(payload);

      expect(key1).toBe(key2);
    });
  });

  describe("cache isolation", () => {
    beforeEach(() => {
      // Clear cache by overwriting global
      (globalThis as { aiResponseCache?: Map<string, unknown> }).aiResponseCache =
        new Map();
    });

    it("should not return cached response from different user", async () => {
      const basePayload = {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.7,
        max_tokens: 1000,
      };

      const keyUserA = buildCacheKey({ ...basePayload, userId: "user-A" });
      const keyUserB = buildCacheKey({ ...basePayload, userId: "user-B" });

      await setCachedResponse(keyUserA, {
        content: "Response for User A",
        modelId: "gpt-4",
        createdAt: Date.now(),
      });

      const cachedForA = await getCachedResponse(keyUserA);
      const cachedForB = await getCachedResponse(keyUserB);

      expect(cachedForA).not.toBeNull();
      expect(cachedForA?.content).toBe("Response for User A");
      expect(cachedForB).toBeNull();
    });

    it("should return cached response for same user", async () => {
      const payload = {
        userId: "user-123",
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.7,
        max_tokens: 1000,
      };

      const key = buildCacheKey(payload);

      await setCachedResponse(key, {
        content: "Cached response",
        modelId: "gpt-4",
        createdAt: Date.now(),
      });

      const cached = await getCachedResponse(key);

      expect(cached).not.toBeNull();
      expect(cached?.content).toBe("Cached response");
    });
  });
});
