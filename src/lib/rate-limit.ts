import { prisma } from "@/lib/db";

type RateEntry = {
  count: number;
  resetAt: number;
};

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: number;
};

type HeaderSource = {
  get(name: string): string | null;
};

type RequestLike = {
  headers: HeaderSource;
} | HeaderSource;

const globalStore = globalThis as unknown as {
  rateLimitStore?: Map<string, RateEntry>;
};

const store = globalStore.rateLimitStore ?? new Map<string, RateEntry>();
if (!globalStore.rateLimitStore) {
  globalStore.rateLimitStore = store;
}

const memoryDriver =
  process.env.RATE_LIMIT_DRIVER === "memory" ||
  process.env.NODE_ENV === "test" ||
  !process.env.DATABASE_URL;

let cleanupCounter = 0;

function cleanupMemoryStore(now: number) {
  cleanupCounter += 1;
  if (cleanupCounter % 100 !== 0) {
    return;
  }

  for (const [key, entry] of store.entries()) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}

function checkRateLimitMemory(params: {
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
  cleanupMemoryStore(now);
  return { ok: true, remaining: params.limit - entry.count, resetAt: entry.resetAt };
}

async function checkRateLimitDatabase(params: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<RateLimitResult> {
  const now = new Date();
  const nextResetAt = new Date(now.getTime() + params.windowMs);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.rateLimitBucket.findUnique({
      where: { key: params.key },
      select: { count: true, resetAt: true },
    });

    if (!existing || existing.resetAt <= now) {
      const record = await tx.rateLimitBucket.upsert({
        where: { key: params.key },
        create: {
          key: params.key,
          count: 1,
          resetAt: nextResetAt,
        },
        update: {
          count: 1,
          resetAt: nextResetAt,
        },
        select: {
          count: true,
          resetAt: true,
        },
      });

      return {
        ok: true,
        remaining: Math.max(0, params.limit - record.count),
        resetAt: record.resetAt.getTime(),
      };
    }

    if (existing.count >= params.limit) {
      return {
        ok: false,
        remaining: 0,
        resetAt: existing.resetAt.getTime(),
      };
    }

    const updated = await tx.rateLimitBucket.update({
      where: { key: params.key },
      data: {
        count: {
          increment: 1,
        },
      },
      select: {
        count: true,
        resetAt: true,
      },
    });

    return {
      ok: updated.count <= params.limit,
      remaining: Math.max(0, params.limit - updated.count),
      resetAt: updated.resetAt.getTime(),
    };
  });

  if (Math.random() < 0.01) {
    void prisma.rateLimitBucket.deleteMany({
      where: {
        resetAt: { lte: now },
      },
    });
  }

  return result;
}

export async function checkRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<RateLimitResult> {
  if (memoryDriver) {
    return checkRateLimitMemory(params);
  }

  return checkRateLimitDatabase(params);
}

export function getClientIp(request: RequestLike) {
  const headers = "headers" in request ? request.headers : request;
  const forwardedFor =
    headers.get("x-forwarded-for") ?? headers.get("x-real-ip") ?? "";

  if (!forwardedFor) {
    return "unknown";
  }

  return forwardedFor.split(",")[0]?.trim() || "unknown";
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
