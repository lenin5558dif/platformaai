import { expect, test, vi } from "vitest";
import assert from "node:assert/strict";
import {
  checkRateLimit,
  getClientIp,
  getRateLimitHeaders,
  getRetryAfterHeader,
} from "../src/lib/rate-limit";

test("checkRateLimit enforces limits within a window", async () => {
  const key = `test:${Date.now()}:${Math.random()}`;

  const first = await checkRateLimit({ key, limit: 2, windowMs: 1000 });
  assert.equal(first.ok, true);
  assert.equal(first.remaining, 1);

  const second = await checkRateLimit({ key, limit: 2, windowMs: 1000 });
  assert.equal(second.ok, true);
  assert.equal(second.remaining, 0);

  const third = await checkRateLimit({ key, limit: 2, windowMs: 1000 });
  assert.equal(third.ok, false);
  assert.equal(third.remaining, 0);
});

test("checkRateLimit resets expired buckets and helper headers map correctly", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const key = `reset:${Date.now()}`;
    const first = await checkRateLimit({ key, limit: 3, windowMs: 1000 });
    assert.equal(first.ok, true);
    assert.equal(first.remaining, 2);

    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
    const second = await checkRateLimit({ key, limit: 3, windowMs: 1000 });
    assert.equal(second.ok, true);
    assert.equal(second.remaining, 2);

    const headers = getRateLimitHeaders({
      limit: 3,
      remaining: 2,
      resetAt: 1704067205000,
    });
    assert.equal(headers["X-RateLimit-Limit"], "3");
    assert.equal(headers["X-RateLimit-Remaining"], "2");
    assert.equal(headers["X-RateLimit-Reset"], "1704067205");

    const retry = getRetryAfterHeader(1704067205000, 1704067201000);
    assert.equal(retry["Retry-After"], "4");
  } finally {
    vi.useRealTimers();
  }
});

test("getClientIp prefers forwarded headers and falls back to unknown", () => {
  assert.equal(
    getClientIp({
      get(name: string) {
        return name === "x-forwarded-for" ? "198.51.100.1, 203.0.113.5" : null;
      },
    }),
    "198.51.100.1",
  );

  assert.equal(
    getClientIp({
      get(name: string) {
        return name === "x-real-ip" ? "203.0.113.8" : null;
      },
    }),
    "203.0.113.8",
  );

  assert.equal(
    getClientIp({
      headers: {
        get() {
          return null;
        },
      },
    } as any),
    "unknown",
  );
});

test("checkRateLimit covers the database driver branches", async () => {
  const findUnique = vi.fn();
  const upsert = vi.fn(async () => ({
    count: 1,
    resetAt: new Date("2026-01-01T00:00:01.000Z"),
  }));
  const update = vi.fn(async () => ({
    count: 2,
    resetAt: new Date("2026-01-01T00:00:01.000Z"),
  }));
  const deleteMany = vi.fn(async () => ({ count: 0 }));
  const transaction = vi.fn(async (callback: any) =>
    callback({
      rateLimitBucket: {
        findUnique,
        upsert,
        update,
      },
    })
  );
  const prismaMock = {
    $transaction: transaction,
    rateLimitBucket: {
      deleteMany,
    },
  };

  vi.useFakeTimers();
  const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
  try {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgres://example";
    delete process.env.RATE_LIMIT_DRIVER;

    vi.doMock("@/lib/db", () => ({ prisma: prismaMock }));
    vi.resetModules();
    const { checkRateLimit: dbCheckRateLimit } = await import("../src/lib/rate-limit");

    findUnique.mockResolvedValueOnce(null);
    const first = await dbCheckRateLimit({ key: "db:one", limit: 3, windowMs: 1000 });
    assert.equal(first.ok, true);
    assert.equal(first.remaining, 2);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledTimes(1);

    findUnique.mockResolvedValueOnce({
      count: 1,
      resetAt: new Date("2026-01-01T00:00:10.000Z"),
    });
    const second = await dbCheckRateLimit({ key: "db:two", limit: 3, windowMs: 1000 });
    assert.equal(second.ok, true);
    assert.equal(second.remaining, 1);
    expect(update).toHaveBeenCalledTimes(1);

    findUnique.mockResolvedValueOnce({
      count: 3,
      resetAt: new Date("2026-01-01T00:00:10.000Z"),
    });
    const third = await dbCheckRateLimit({ key: "db:three", limit: 3, windowMs: 1000 });
    assert.equal(third.ok, false);
    assert.equal(third.remaining, 0);
  } finally {
    randomSpy.mockRestore();
    vi.useRealTimers();
    vi.unmock("@/lib/db");
    vi.resetModules();
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = "test";
  }
});
