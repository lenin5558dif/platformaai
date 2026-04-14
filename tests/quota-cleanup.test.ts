import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "../src/app/api/internal/cron/quota-cleanup/route";
import { DEFAULT_RESERVATION_TTL_MS } from "../src/lib/quota-manager";

// Mock prisma - factory must be self-contained (hoisted)
vi.mock("@/lib/db", () => {
  const mockUpdateMany = vi.fn();
  const mockCount = vi.fn();
  const mockAggregate = vi.fn();

  return {
    prisma: {
      quotaReservation: {
        updateMany: mockUpdateMany,
        count: mockCount,
        aggregate: mockAggregate,
      },
    },
    // Export mock functions so tests can access them
    mockPrismaFns: {
      mockUpdateMany,
      mockCount,
      mockAggregate,
    },
  };
});

// Import the mocked module to get access to mock functions
const { mockPrismaFns } = await vi.importMock("@/lib/db") as {
  mockPrismaFns: {
    mockUpdateMany: ReturnType<typeof vi.fn>;
    mockCount: ReturnType<typeof vi.fn>;
    mockAggregate: ReturnType<typeof vi.fn>;
  };
};

describe("quota-cleanup cron route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, CRON_SECRET: "test-secret" };
    // Freeze time for deterministic tests
    vi.setSystemTime(new Date("2026-02-03T12:00:00.000Z"));
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.useRealTimers();
  });

  test("returns 401 when x-cron-secret header is missing", async () => {
    const req = new Request("http://localhost/api/internal/cron/quota-cleanup", {
      method: "POST",
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(mockPrismaFns.mockUpdateMany).not.toHaveBeenCalled();
    expect(mockPrismaFns.mockCount).not.toHaveBeenCalled();
    expect(mockPrismaFns.mockAggregate).not.toHaveBeenCalled();
  });

  test("returns 401 when x-cron-secret header is wrong", async () => {
    const req = new Request("http://localhost/api/internal/cron/quota-cleanup", {
      method: "POST",
      headers: { "x-cron-secret": "wrong-secret" },
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(mockPrismaFns.mockUpdateMany).not.toHaveBeenCalled();
    expect(mockPrismaFns.mockCount).not.toHaveBeenCalled();
    expect(mockPrismaFns.mockAggregate).not.toHaveBeenCalled();
  });

  test("returns 401 when CRON_SECRET env is not set", async () => {
    delete process.env.CRON_SECRET;

    const req = new Request("http://localhost/api/internal/cron/quota-cleanup", {
      method: "POST",
      headers: { "x-cron-secret": "test-secret" },
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(mockPrismaFns.mockUpdateMany).not.toHaveBeenCalled();
    expect(mockPrismaFns.mockCount).not.toHaveBeenCalled();
    expect(mockPrismaFns.mockAggregate).not.toHaveBeenCalled();
  });

  test("with valid secret, calls updateMany with correct where and data", async () => {
    const now = new Date("2026-02-03T12:00:00.000Z");
    const cutoff = new Date(now.getTime() - DEFAULT_RESERVATION_TTL_MS);

    mockPrismaFns.mockUpdateMany.mockResolvedValue({ count: 5 });
    mockPrismaFns.mockCount.mockResolvedValue(10);
    mockPrismaFns.mockAggregate.mockResolvedValue({ _sum: { amount: 100 } });

    const req = new Request("http://localhost/api/internal/cron/quota-cleanup", {
      method: "POST",
      headers: { "x-cron-secret": "test-secret" },
    });

    const res = await POST(req);

    expect(res.status).toBe(200);

    // Verify updateMany was called with correct parameters
    expect(mockPrismaFns.mockUpdateMany).toHaveBeenCalledWith({
      where: {
        consumedAt: null,
        releasedAt: null,
        reservedAt: { lt: cutoff },
      },
      data: { releasedAt: now },
    });

    // Verify count was called for active reservations
    expect(mockPrismaFns.mockCount).toHaveBeenCalledWith({
      where: {
        consumedAt: null,
        releasedAt: null,
        reservedAt: { gte: cutoff },
      },
    });

    // Verify aggregate was called for active amount
    expect(mockPrismaFns.mockAggregate).toHaveBeenCalledWith({
      where: {
        consumedAt: null,
        releasedAt: null,
        reservedAt: { gte: cutoff },
      },
      _sum: { amount: true },
    });

    // Verify count was called for consumed since cutoff
    expect(mockPrismaFns.mockCount).toHaveBeenCalledWith({
      where: {
        consumedAt: { gte: cutoff },
      },
    });
  });

  test("returns correct response with cleanup stats", async () => {
    const now = new Date("2026-02-03T12:00:00.000Z");
    const cutoff = new Date(now.getTime() - DEFAULT_RESERVATION_TTL_MS);

    mockPrismaFns.mockUpdateMany.mockResolvedValue({ count: 3 });
    mockPrismaFns.mockCount
      .mockResolvedValueOnce(7) // activeCount
      .mockResolvedValueOnce(2); // consumedSinceCutoff
    mockPrismaFns.mockAggregate.mockResolvedValue({ _sum: { amount: 50 } });

    const req = new Request("http://localhost/api/internal/cron/quota-cleanup", {
      method: "POST",
      headers: { "x-cron-secret": "test-secret" },
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      released: 3,
      activeCount: 7,
      activeAmount: 50,
      consumedSinceCutoff: 2,
      cutoff: cutoff.toISOString(),
    });
  });

  test("handles null aggregate amount gracefully", async () => {
    mockPrismaFns.mockUpdateMany.mockResolvedValue({ count: 0 });
    mockPrismaFns.mockCount.mockResolvedValue(0);
    mockPrismaFns.mockAggregate.mockResolvedValue({ _sum: { amount: null } });

    const req = new Request("http://localhost/api/internal/cron/quota-cleanup", {
      method: "POST",
      headers: { "x-cron-secret": "test-secret" },
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.activeAmount).toBe(0);
  });
});
