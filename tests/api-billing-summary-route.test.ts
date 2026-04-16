import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticated: true,
  user: null as null | Record<string, unknown>,
  resetResult: {
    dailySpent: 0,
    monthlySpent: 0,
    dailyResetAt: new Date("2026-04-16T00:00:00.000Z"),
    monthlyResetAt: new Date("2026-04-16T00:00:00.000Z"),
  },
  transactions: [] as Array<Record<string, unknown>>,
}));

const mockApplyLimitResets = vi.fn(() => state.resetResult);
const mockUserUpdate = vi.fn(async () => ({ ok: true }));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (state.authenticated ? { user: { id: "user_1" } } : null)),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => state.user),
      update: mockUserUpdate,
    },
    transaction: {
      findMany: vi.fn(async () => state.transactions),
    },
  },
}));

vi.mock("@/lib/limits", () => ({
  applyLimitResets: mockApplyLimitResets,
}));

describe("api billing summary route", () => {
  beforeEach(() => {
    state.authenticated = true;
    state.user = {
      balance: 30,
      dailySpent: 12,
      monthlySpent: 45,
      dailyLimit: 100,
      monthlyLimit: 300,
      dailyResetAt: new Date("2026-04-15T00:00:00.000Z"),
      monthlyResetAt: new Date("2026-03-01T00:00:00.000Z"),
      org: {
        budget: 1000,
        spent: 80,
      },
    };
    state.resetResult = {
      dailySpent: 0,
      monthlySpent: 5,
      dailyResetAt: new Date("2026-04-16T00:00:00.000Z"),
      monthlyResetAt: new Date("2026-04-16T00:00:00.000Z"),
    };
    state.transactions = [
      {
        id: "tx_1",
        type: "REFILL",
        amount: 15,
        createdAt: new Date("2026-04-16T12:00:00.000Z"),
      },
      {
        id: "tx_2",
        type: "SPEND",
        amount: 3,
        createdAt: new Date("2026-04-16T12:05:00.000Z"),
      },
    ];
    mockApplyLimitResets.mockClear();
    mockUserUpdate.mockClear();
    vi.clearAllMocks();
  });

  test("returns 401 when the session is missing", async () => {
    state.authenticated = false;
    const { GET } = await import("../src/app/api/billing/summary/route");
    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  test("returns a zeroed summary when the user record is missing", async () => {
    state.user = null;
    state.transactions = [];
    const { GET } = await import("../src/app/api/billing/summary/route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      markup: 2,
      balance: "0",
      balanceLabel: "0.00 кредитов",
      dailySpent: "0",
      dailySpentLabel: "0.00 кредитов",
      monthlySpent: "0",
      monthlySpentLabel: "0.00 кредитов",
      dailyLimit: null,
      monthlyLimit: null,
      org: null,
      transactions: [],
    });
  });

  test("returns the billing summary and persists reset values", async () => {
    const { GET } = await import("../src/app/api/billing/summary/route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      markup: 2,
      balance: "30",
      balanceLabel: "30.00 кредитов",
      dailySpent: "0",
      dailySpentLabel: "0.00 кредитов",
      monthlySpent: "5",
      monthlySpentLabel: "5.00 кредитов",
      dailyLimit: "100",
      monthlyLimit: "300",
      org: {
        budget: "1000",
        spent: "80",
        spentLabel: "80.00 кредитов",
      },
    });

    expect(mockApplyLimitResets).toHaveBeenCalledWith({
      dailySpent: 12,
      monthlySpent: 45,
      dailyResetAt: new Date("2026-04-15T00:00:00.000Z"),
      monthlyResetAt: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(json.transactions).toEqual([
      expect.objectContaining({
        id: "tx_1",
        amount: "15",
        amountLabel: "+15.00",
        direction: "Пополнение",
      }),
      expect.objectContaining({
        id: "tx_2",
        amount: "3",
        amountLabel: "-3.00",
        direction: "Списание",
      }),
    ]);
  });

  test("skips persistence when reset values did not change and keeps org null", async () => {
    state.user = {
      balance: 5,
      dailySpent: 4,
      monthlySpent: 9,
      dailyLimit: null,
      monthlyLimit: null,
      dailyResetAt: new Date("2026-04-16T00:00:00.000Z"),
      monthlyResetAt: new Date("2026-04-16T00:00:00.000Z"),
      org: null,
    };
    state.resetResult = {
      dailySpent: 4,
      monthlySpent: 9,
      dailyResetAt: new Date("2026-04-16T00:00:00.000Z"),
      monthlyResetAt: new Date("2026-04-16T00:00:00.000Z"),
    };

    const { GET } = await import("../src/app/api/billing/summary/route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.org).toBeNull();
    expect(json.dailyLimit).toBeNull();
    expect(json.monthlyLimit).toBeNull();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});
