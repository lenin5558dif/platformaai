import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  applyLimitResets: vi.fn(),
  spendCredits: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/limits", () => ({
  applyLimitResets: mocks.applyLimitResets,
}));

vi.mock("@/lib/billing", () => ({
  spendCredits: mocks.spendCredits,
}));

import { GET as getBillingSummary } from "@/app/api/billing/summary/route";
import { POST as postBillingSpend } from "@/app/api/billing/spend/route";
import { GET as getMe } from "@/app/api/me/route";

describe("account and billing API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.applyLimitResets.mockImplementation((params: any) => params);
    mocks.prisma.user.findUnique.mockReset();
    mocks.prisma.user.update.mockReset();
    mocks.prisma.transaction.findMany.mockReset();
    mocks.spendCredits.mockReset();
  });

  describe("GET /api/billing/summary", () => {
    test("returns 401 when unauthenticated", async () => {
      mocks.auth.mockResolvedValue(null);

      const response = await getBillingSummary();

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
      expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
    });

    test("returns fallback zeros when the user record is missing", async () => {
      mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
      mocks.prisma.user.findUnique.mockResolvedValue(null);
      mocks.prisma.transaction.findMany.mockResolvedValue([]);

      const response = await getBillingSummary();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        balance: "0",
        topUpBalance: "0",
        includedCreditsRemaining: "0",
        dailySpent: "0",
        monthlySpent: "0",
        dailyLimit: null,
        monthlyLimit: null,
        subscription: null,
        org: null,
        transactions: [],
      });
      expect(mocks.prisma.user.update).not.toHaveBeenCalled();
    });

    test("keeps current counters untouched when resets do not change", async () => {
      mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
      mocks.prisma.user.findUnique.mockResolvedValue({
        balance: 12,
        dailySpent: 4,
        monthlySpent: 8,
        dailyLimit: 50,
        monthlyLimit: 100,
        dailyResetAt: new Date("2026-04-14T00:00:00.000Z"),
        monthlyResetAt: new Date("2026-04-01T00:00:00.000Z"),
        org: null,
      });
      mocks.prisma.transaction.findMany.mockResolvedValue([]);

      const response = await getBillingSummary();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        balance: "12",
        topUpBalance: "12",
        includedCreditsRemaining: "0",
        dailySpent: "4",
        monthlySpent: "8",
        dailyLimit: "50",
        monthlyLimit: "100",
        subscription: null,
        org: null,
        transactions: [],
      });
      expect(mocks.prisma.user.update).not.toHaveBeenCalled();
    });

    test("uses fallback reset timestamps when the database values are null", async () => {
      mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
      mocks.prisma.user.findUnique.mockResolvedValue({
        balance: 18,
        dailySpent: 6,
        monthlySpent: 10,
        dailyLimit: 50,
        monthlyLimit: 100,
        dailyResetAt: null,
        monthlyResetAt: null,
        org: null,
      });
      mocks.prisma.transaction.findMany.mockResolvedValue([]);
      mocks.applyLimitResets.mockImplementation((params: any) => {
        expect(params.dailyResetAt).toBeInstanceOf(Date);
        expect(params.monthlyResetAt).toBeInstanceOf(Date);
        return {
          dailySpent: params.dailySpent,
          monthlySpent: params.monthlySpent,
          dailyResetAt: params.dailyResetAt,
          monthlyResetAt: params.monthlyResetAt,
        };
      });

      const response = await getBillingSummary();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        balance: "18",
        topUpBalance: "18",
        includedCreditsRemaining: "0",
        dailySpent: "6",
        monthlySpent: "10",
        dailyLimit: "50",
        monthlyLimit: "100",
        subscription: null,
        org: null,
        transactions: [],
      });
      expect(mocks.prisma.user.update).not.toHaveBeenCalled();
    });

    test("falls back to zero when the stored spend counters are null", async () => {
      mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
      mocks.prisma.user.findUnique.mockResolvedValue({
        balance: 22,
        dailySpent: null,
        monthlySpent: null,
        dailyLimit: 50,
        monthlyLimit: 100,
        dailyResetAt: new Date("2026-04-14T00:00:00.000Z"),
        monthlyResetAt: new Date("2026-04-01T00:00:00.000Z"),
        org: null,
      });
      mocks.prisma.transaction.findMany.mockResolvedValue([]);
      mocks.applyLimitResets.mockReturnValue({
        dailySpent: 0,
        monthlySpent: 0,
        dailyResetAt: new Date("2026-04-14T00:00:00.000Z"),
        monthlyResetAt: new Date("2026-04-01T00:00:00.000Z"),
      });

      const response = await getBillingSummary();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        balance: "22",
        topUpBalance: "22",
        includedCreditsRemaining: "0",
        dailySpent: "0",
        monthlySpent: "0",
        dailyLimit: "50",
        monthlyLimit: "100",
        subscription: null,
        org: null,
        transactions: [],
      });
      expect(mocks.prisma.user.update).not.toHaveBeenCalled();
    });

    test("resets stale counters and serializes summary data", async () => {
      mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
      mocks.applyLimitResets.mockReturnValue({
        dailySpent: 3,
        monthlySpent: 9,
        dailyResetAt: new Date("2026-04-14T00:00:00.000Z"),
        monthlyResetAt: new Date("2026-04-01T00:00:00.000Z"),
      });
      mocks.prisma.user.findUnique.mockResolvedValue({
        balance: 42,
        dailySpent: 7,
        monthlySpent: 11,
        dailyLimit: 50,
        monthlyLimit: 100,
        dailyResetAt: new Date("2026-04-13T00:00:00.000Z"),
        monthlyResetAt: new Date("2026-03-01T00:00:00.000Z"),
        org: {
          budget: 500,
          spent: 123,
        },
      });
      mocks.prisma.transaction.findMany.mockResolvedValue([
        {
          id: "tx-1",
          amount: 15,
          createdAt: new Date("2026-04-14T08:00:00.000Z"),
        },
      ]);

      const response = await getBillingSummary();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        balance: "42",
        topUpBalance: "42",
        includedCreditsRemaining: "0",
        dailySpent: "3",
        monthlySpent: "9",
        dailyLimit: "50",
        monthlyLimit: "100",
        subscription: null,
        org: {
          budget: "500",
          spent: "123",
        },
        transactions: [
          {
            id: "tx-1",
            amount: "15",
            createdAt: "2026-04-14T08:00:00.000Z",
          },
        ],
      });
      expect(mocks.prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: {
          dailySpent: 3,
          monthlySpent: 9,
          dailyResetAt: new Date("2026-04-14T00:00:00.000Z"),
          monthlyResetAt: new Date("2026-04-01T00:00:00.000Z"),
        },
      });
    });

    test("updates when only the monthly reset changes", async () => {
      mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
      mocks.applyLimitResets.mockReturnValue({
        dailySpent: 5,
        monthlySpent: 2,
        dailyResetAt: new Date("2026-04-14T00:00:00.000Z"),
        monthlyResetAt: new Date("2026-04-14T00:00:00.000Z"),
      });
      mocks.prisma.user.findUnique.mockResolvedValue({
        balance: 30,
        dailySpent: 5,
        monthlySpent: 9,
        dailyLimit: 50,
        monthlyLimit: 100,
        dailyResetAt: new Date("2026-04-14T00:00:00.000Z"),
        monthlyResetAt: new Date("2026-03-01T00:00:00.000Z"),
        org: null,
      });
      mocks.prisma.transaction.findMany.mockResolvedValue([]);

      const response = await getBillingSummary();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        balance: "30",
        topUpBalance: "30",
        includedCreditsRemaining: "0",
        dailySpent: "5",
        monthlySpent: "2",
        dailyLimit: "50",
        monthlyLimit: "100",
        subscription: null,
        org: null,
        transactions: [],
      });
      expect(mocks.prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: {
          dailySpent: 5,
          monthlySpent: 2,
          dailyResetAt: new Date("2026-04-14T00:00:00.000Z"),
          monthlyResetAt: new Date("2026-04-14T00:00:00.000Z"),
        },
      });
    });

    test("returns subscription details and included credits when present", async () => {
      mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
      mocks.prisma.user.findUnique.mockResolvedValue({
        balance: 30,
        dailySpent: 5,
        monthlySpent: 2,
        dailyLimit: 50,
        monthlyLimit: 100,
        dailyResetAt: new Date("2026-04-14T00:00:00.000Z"),
        monthlyResetAt: new Date("2026-04-14T00:00:00.000Z"),
        subscription: {
          status: "ACTIVE",
          currentPeriodStart: new Date("2026-04-01T00:00:00.000Z"),
          currentPeriodEnd: new Date("2099-05-01T00:00:00.000Z"),
          includedCredits: { toString: () => "100.00" },
          includedCreditsUsed: { toString: () => "25.00" },
          cancelAtPeriodEnd: false,
          plan: {
            code: "creator",
            name: "Креатор",
            monthlyPriceUsd: { toString: () => "29.00" },
            includedCreditsPerMonth: { toString: () => "100.00" },
          },
        },
        org: null,
      });
      mocks.prisma.transaction.findMany.mockResolvedValue([]);

      const response = await getBillingSummary();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        balance: "30",
        topUpBalance: "30",
        includedCreditsRemaining: "75",
        dailySpent: "5",
        monthlySpent: "2",
        dailyLimit: "50",
        monthlyLimit: "100",
        subscription: {
          status: "ACTIVE",
          currentPeriodStart: "2026-04-01T00:00:00.000Z",
          currentPeriodEnd: "2099-05-01T00:00:00.000Z",
          includedCredits: "100.00",
          includedCreditsUsed: "25.00",
          cancelAtPeriodEnd: false,
          plan: {
            code: "creator",
            name: "Креатор",
            monthlyPriceUsd: "29.00",
            includedCreditsPerMonth: "100.00",
          },
        },
        org: null,
        transactions: [],
      });
    });
  });

  describe("POST /api/billing/spend", () => {
    test("returns 401 when unauthenticated", async () => {
      mocks.auth.mockResolvedValue(null);

      const response = await postBillingSpend(
        new Request("http://localhost/api/billing/spend", {
          method: "POST",
          body: JSON.stringify({ amount: 10 }),
        })
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
      expect(mocks.spendCredits).not.toHaveBeenCalled();
    });

    test("creates a spend transaction and stringifies numeric fields", async () => {
      mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
      mocks.spendCredits.mockResolvedValue({
        transaction: {
          id: "tx-1",
          amount: 12,
          description: "API spend",
        },
        balance: 88,
      });

      const response = await postBillingSpend(
        new Request("http://localhost/api/billing/spend", {
          method: "POST",
          body: JSON.stringify({ amount: 12, description: "API spend" }),
        })
      );

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({
        transaction: {
          id: "tx-1",
          amount: "12",
          description: "API spend",
        },
        balance: "88",
      });
      expect(mocks.spendCredits).toHaveBeenCalledWith({
        userId: "user-1",
        amount: 12,
        description: "API spend",
      });
    });

    test.each([
      ["INSUFFICIENT_BALANCE", "Insufficient balance"],
      ["DAILY_LIMIT_EXCEEDED", "Daily limit exceeded"],
      ["MONTHLY_LIMIT_EXCEEDED", "Monthly limit exceeded"],
      ["ORG_BUDGET_EXCEEDED", "Organization budget exceeded"],
      ["USER_NOT_FOUND", "User not found"],
    ])("maps %s to a %s response", async (errorMessage, errorBody) => {
      mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
      mocks.spendCredits.mockRejectedValue(new Error(errorMessage));

      const response = await postBillingSpend(
        new Request("http://localhost/api/billing/spend", {
          method: "POST",
          body: JSON.stringify({ amount: 12 }),
        })
      );

      const expectedStatus = errorMessage === "USER_NOT_FOUND" ? 404 : 409;
      expect(response.status).toBe(expectedStatus);
      expect(await response.json()).toEqual({ error: errorBody });
    });

    test("rethrows unexpected errors", async () => {
      mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
      mocks.spendCredits.mockRejectedValue(new Error("boom"));

      await expect(
        postBillingSpend(
          new Request("http://localhost/api/billing/spend", {
            method: "POST",
            body: JSON.stringify({ amount: 12 }),
          })
        )
      ).rejects.toThrow("boom");
    });
  });

  describe("GET /api/me", () => {
    test("returns 401 when unauthenticated", async () => {
      mocks.auth.mockResolvedValue(null);

      const response = await getMe();

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    });

    test("returns 404 when the user is missing", async () => {
      mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
      mocks.prisma.user.findUnique.mockResolvedValue(null);

      const response = await getMe();

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    });

    test("serializes user data and linked channels", async () => {
      mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
      mocks.prisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "user@example.com",
        role: "ADMIN",
        balance: 77,
        settings: { theme: "dark" },
        channelBindings: [
          {
            channel: "telegram",
            createdAt: new Date("2026-04-14T09:30:00.000Z"),
          },
          {
            channel: "slack",
            createdAt: new Date("2026-04-14T10:00:00.000Z"),
          },
        ],
      });

      const response = await getMe();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        data: {
          id: "user-1",
          email: "user@example.com",
          role: "ADMIN",
          balance: "77",
          settings: { theme: "dark" },
          channelBindings: [
            {
              channel: "telegram",
              createdAt: "2026-04-14T09:30:00.000Z",
            },
            {
              channel: "slack",
              createdAt: "2026-04-14T10:00:00.000Z",
            },
          ],
          channels: [
            {
              channel: "telegram",
              linkedAt: "2026-04-14T09:30:00.000Z",
            },
            {
              channel: "slack",
              linkedAt: "2026-04-14T10:00:00.000Z",
            },
          ],
        },
      });
    });
  });
});
