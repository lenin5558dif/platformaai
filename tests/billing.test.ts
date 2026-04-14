import { beforeEach, describe, expect, test, vi } from "vitest";

const fixedDay = {
  kind: "day" as const,
  key: "day:2026-04-14T00:00:00.000Z",
  start: new Date("2026-04-14T00:00:00.000Z"),
  end: new Date("2026-04-15T00:00:00.000Z"),
};

const fixedMonth = {
  kind: "month" as const,
  key: "month:2026-04-01T00:00:00.000Z",
  start: new Date("2026-04-01T00:00:00.000Z"),
  end: new Date("2026-05-01T00:00:00.000Z"),
};

const fixedAllTime = {
  kind: "all_time" as const,
  key: "all_time",
  start: new Date("1970-01-01T00:00:00.000Z"),
  end: new Date("9999-12-31T23:59:59.999Z"),
};

const state = vi.hoisted(() => ({
  applyLimitResets: vi.fn(),
  qmReserve: vi.fn(),
  qmCommit: vi.fn(),
  qmRelease: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    quotaBucket: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  tx: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
    },
    organization: {
      update: vi.fn(),
    },
    quotaBucket: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: state.prisma,
}));

vi.mock("@/lib/limits", () => ({
  applyLimitResets: state.applyLimitResets,
}));

vi.mock("@/lib/quota-manager", () => ({
  QuotaManager: class {
    reserve = state.qmReserve;
    commit = state.qmCommit;
    release = state.qmRelease;
  },
  getUtcDayPeriod: vi.fn(() => fixedDay),
  getUtcMonthPeriod: vi.fn(() => fixedMonth),
  getAllTimePeriod: vi.fn(() => fixedAllTime),
}));

async function loadBilling() {
  vi.resetModules();
  return import("../src/lib/billing");
}

function baseUser(overrides: Record<string, unknown> = {}) {
  return {
    balance: 100,
    dailyLimit: 50,
    monthlyLimit: 200,
    dailySpent: 10,
    monthlySpent: 20,
    dailyResetAt: new Date("2026-04-14T00:00:00.000Z"),
    monthlyResetAt: new Date("2026-04-01T00:00:00.000Z"),
    org: null,
    ...overrides,
  };
}

describe("billing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.prisma.user.findUnique.mockReset();
    state.prisma.quotaBucket.findUnique.mockReset();
    state.prisma.$transaction.mockReset();
    state.applyLimitResets.mockReset();
    state.tx.user.findUnique.mockReset();
    state.tx.user.update.mockReset();
    state.tx.transaction.create.mockReset();
    state.tx.organization.update.mockReset();
    state.tx.quotaBucket.upsert.mockReset();
    state.qmReserve.mockReset();
    state.qmCommit.mockReset();
    state.qmRelease.mockReset();

    state.prisma.$transaction.mockImplementation(async (cb: any) => cb(state.tx));
    state.applyLimitResets.mockImplementation((params: any) => ({
      dailySpent: params.dailySpent,
      monthlySpent: params.monthlySpent,
      dailyResetAt: params.dailyResetAt,
      monthlyResetAt: params.monthlyResetAt,
    }));
    state.tx.transaction.create.mockResolvedValue({ id: "tx-1", amount: 15 });
    state.tx.user.update.mockResolvedValue({ balance: 85 });
    state.tx.organization.update.mockResolvedValue({});
    state.tx.quotaBucket.upsert.mockResolvedValue({});
    state.qmReserve.mockResolvedValue({
      reservations: [{ id: "r-1", scope: "ORG", subjectId: "org-1", requestId: "req-1" }],
    });
    state.qmCommit.mockResolvedValue(undefined);
    state.qmRelease.mockResolvedValue(undefined);
  });

  test("preflightCredits validates default minimum and all failure branches", async () => {
    const { preflightCredits } = await loadBilling();

    state.prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(preflightCredits({ userId: "u-1" })).rejects.toThrow("USER_NOT_FOUND");

    state.prisma.user.findUnique.mockResolvedValueOnce(baseUser({ balance: 0 }));
    await expect(preflightCredits({ userId: "u-1" })).rejects.toThrow("INSUFFICIENT_BALANCE");

    state.prisma.user.findUnique.mockResolvedValueOnce(baseUser({ dailyLimit: 10, dailySpent: 10 }));
    await expect(preflightCredits({ userId: "u-1", minAmount: 1 })).rejects.toThrow("DAILY_LIMIT_EXCEEDED");

    state.prisma.user.findUnique.mockResolvedValueOnce(baseUser({ monthlyLimit: 20, monthlySpent: 20, dailyLimit: 0 }));
    await expect(preflightCredits({ userId: "u-1", minAmount: 1 })).rejects.toThrow("MONTHLY_LIMIT_EXCEEDED");

    state.prisma.user.findUnique.mockResolvedValueOnce(
      baseUser({
        dailyLimit: 0,
        monthlyLimit: 0,
        org: { budget: 25, spent: 25 },
      }),
    );
    await expect(preflightCredits({ userId: "u-1", minAmount: 1 })).rejects.toThrow("ORG_BUDGET_EXCEEDED");

    state.prisma.user.findUnique.mockResolvedValueOnce(
      baseUser({
        dailyLimit: 0,
        monthlyLimit: 0,
        dailySpent: 0,
        monthlySpent: 0,
      }),
    );
    await expect(preflightCredits({ userId: "u-1" })).resolves.toBeUndefined();

    state.prisma.user.findUnique.mockResolvedValueOnce(
      baseUser({
        dailyLimit: 10,
        monthlyLimit: 20,
        dailySpent: 1,
        monthlySpent: 1,
        org: { budget: 0, spent: 999 },
      }),
    );
    await expect(preflightCredits({ userId: "u-1", minAmount: 1 })).resolves.toBeUndefined();
  });

  test("preflightCredits handles nullish numeric fields via fallback defaults", async () => {
    const { preflightCredits } = await loadBilling();

    state.prisma.user.findUnique.mockResolvedValueOnce({
      balance: null,
      dailyLimit: null,
      monthlyLimit: null,
      dailySpent: null,
      monthlySpent: null,
      dailyResetAt: null,
      monthlyResetAt: null,
      org: { budget: null, spent: null },
    });

    await expect(preflightCredits({ userId: "u-1" })).rejects.toThrow("INSUFFICIENT_BALANCE");
  });

  test("spendCredits enforces missing user, balance and limit checks", async () => {
    const { spendCredits } = await loadBilling();

    state.tx.user.findUnique.mockResolvedValueOnce(null);
    await expect(spendCredits({ userId: "u-1", amount: 5 })).rejects.toThrow("USER_NOT_FOUND");

    state.tx.user.findUnique.mockResolvedValueOnce(baseUser({ balance: 3 }));
    await expect(spendCredits({ userId: "u-1", amount: 5 })).rejects.toThrow("INSUFFICIENT_BALANCE");

    state.tx.user.findUnique.mockResolvedValueOnce(baseUser({ dailyLimit: 10, dailySpent: 10 }));
    await expect(spendCredits({ userId: "u-1", amount: 1 })).rejects.toThrow("DAILY_LIMIT_EXCEEDED");

    state.tx.user.findUnique.mockResolvedValueOnce(baseUser({ dailyLimit: 0, monthlyLimit: 20, monthlySpent: 20 }));
    await expect(spendCredits({ userId: "u-1", amount: 1 })).rejects.toThrow("MONTHLY_LIMIT_EXCEEDED");

    state.tx.user.findUnique.mockResolvedValueOnce(
      baseUser({
        dailyLimit: 0,
        monthlyLimit: 0,
        org: { id: "org-1", budget: 10, spent: 10 },
      }),
    );
    await expect(spendCredits({ userId: "u-1", amount: 1 })).rejects.toThrow("ORG_BUDGET_EXCEEDED");
  });

  test("spendCredits records personal spend with inherited cost center and increment updates", async () => {
    const { spendCredits } = await loadBilling();

    state.tx.user.findUnique.mockResolvedValueOnce(
      baseUser({
        costCenterId: "cc-user",
      }),
    );

    const result = await spendCredits({ userId: "u-1", amount: 15 });

    expect(state.tx.transaction.create).toHaveBeenCalledWith({
      data: {
        userId: "u-1",
        costCenterId: "cc-user",
        amount: 15,
        type: "SPEND",
        description: "Списание за запрос",
      },
    });
    expect(state.tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "u-1",
          balance: { gte: 15 },
        },
        data: expect.objectContaining({
          balance: { decrement: 15 },
          dailySpent: { increment: 15 },
          monthlySpent: { increment: 15 },
        }),
      }),
    );
    expect(state.tx.organization.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      transaction: { id: "tx-1", amount: 15 },
      balance: 85,
    });
  });

  test("spendCredits syncs org quota buckets and reset-based counters", async () => {
    const { spendCredits } = await loadBilling();

    const nextResetAt = new Date("2026-04-14T12:00:00.000Z");
    state.applyLimitResets.mockReturnValue({
      dailySpent: 0,
      monthlySpent: 0,
      dailyResetAt: nextResetAt,
      monthlyResetAt: nextResetAt,
    });
    state.tx.user.findUnique.mockResolvedValueOnce(
      baseUser({
        costCenterId: "ignored-local-cc",
        org: { id: "org-1", budget: 500, spent: 100 },
      }),
    );

    await spendCredits({
      userId: "u-1",
      amount: 15,
      description: "manual spend",
      costCenterId: "cc-explicit",
    });

    expect(state.tx.transaction.create).toHaveBeenCalledWith({
      data: {
        userId: "u-1",
        costCenterId: "cc-explicit",
        amount: 15,
        type: "SPEND",
        description: "manual spend",
      },
    });
    expect(state.tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dailySpent: 15,
          monthlySpent: 15,
          dailyResetAt: nextResetAt,
          monthlyResetAt: nextResetAt,
        }),
      }),
    );
    expect(state.tx.organization.update).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: { spent: { increment: 15 } },
    });
    expect(state.tx.quotaBucket.upsert).toHaveBeenCalledTimes(4);
    expect(state.tx.quotaBucket.upsert.mock.calls[3]?.[0]).toMatchObject({
      create: {
        orgId: "org-1",
        scope: "COST_CENTER",
        subjectId: "cc-explicit",
        limit: 0,
        spent: 15,
        reserved: 0,
      },
      update: {
        spent: { increment: 15 },
      },
    });
  });

  test("spendCredits remaps concurrent p2025 failure to insufficient balance", async () => {
    const { spendCredits } = await loadBilling();

    state.tx.user.findUnique.mockResolvedValueOnce(baseUser());
    state.tx.user.update.mockRejectedValueOnce({ code: "P2025" });

    await expect(spendCredits({ userId: "u-1", amount: 5 })).rejects.toThrow("INSUFFICIENT_BALANCE");
  });

  test("spendCredits rethrows unexpected update failures and skips cost-center bucket when absent", async () => {
    const { spendCredits } = await loadBilling();

    state.tx.user.findUnique.mockResolvedValueOnce(
      baseUser({
        org: { id: "org-1", budget: 500, spent: 100 },
      }),
    );
    state.tx.user.update.mockRejectedValueOnce(new Error("db down"));

    await expect(spendCredits({ userId: "u-1", amount: 5 })).rejects.toThrow("db down");

    state.tx.user.findUnique.mockResolvedValueOnce(
      baseUser({
        org: { id: "org-1", budget: 500, spent: 100 },
      }),
    );
    state.tx.user.update.mockResolvedValueOnce({ balance: 95 });

    await spendCredits({ userId: "u-1", amount: 5 });

    expect(state.tx.quotaBucket.upsert).toHaveBeenCalledTimes(3);
  });

  test("spendCredits still syncs org buckets when org budget is disabled", async () => {
    const { spendCredits } = await loadBilling();

    state.tx.user.findUnique.mockResolvedValueOnce(
      baseUser({
        dailyLimit: 0,
        monthlyLimit: 0,
        org: { id: "org-1", budget: 0, spent: 100 },
      }),
    );
    state.tx.user.update.mockResolvedValueOnce({ balance: 95 });

    await spendCredits({ userId: "u-1", amount: 5 });

    expect(state.tx.organization.update).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: { spent: { increment: 5 } },
    });
    expect(state.tx.quotaBucket.upsert).toHaveBeenCalledTimes(3);
  });

  test("spendCredits tolerates nullish counters and timestamps", async () => {
    const { spendCredits } = await loadBilling();

    state.tx.user.findUnique.mockResolvedValueOnce({
      balance: 50,
      dailyLimit: null,
      monthlyLimit: null,
      dailySpent: null,
      monthlySpent: null,
      dailyResetAt: null,
      monthlyResetAt: null,
      costCenterId: null,
      org: { id: "org-1", budget: null, spent: null },
    });
    state.applyLimitResets.mockReturnValue({
      dailySpent: 0,
      monthlySpent: 0,
      dailyResetAt: new Date("2026-04-14T05:00:00.000Z"),
      monthlyResetAt: new Date("2026-04-14T05:00:00.000Z"),
    });
    state.tx.user.update.mockResolvedValueOnce({ balance: 45 });

    const result = await spendCredits({ userId: "u-1", amount: 5 });

    expect(result.balance).toBe(45);
    expect(state.tx.quotaBucket.upsert).toHaveBeenCalledTimes(3);
    expect(state.tx.quotaBucket.upsert.mock.calls[2]?.[0]).toMatchObject({
      create: {
        orgId: "org-1",
        limit: 0,
        spent: 5,
      },
      update: {
        limit: 0,
        spent: { increment: 5 },
      },
    });
  });

  test("reserveAiQuotaHold handles missing users, no-org users and successful multi-constraint holds", async () => {
    const { reserveAiQuotaHold } = await loadBilling();

    state.prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(
      reserveAiQuotaHold({ userId: "u-1", amount: 5, idempotencyKey: "req-1" }),
    ).rejects.toThrow("USER_NOT_FOUND");

    state.prisma.user.findUnique.mockResolvedValueOnce(baseUser({ balance: 1 }));
    await expect(
      reserveAiQuotaHold({ userId: "u-1", amount: 5, idempotencyKey: "req-1" }),
    ).rejects.toThrow("INSUFFICIENT_BALANCE");

    state.prisma.user.findUnique.mockResolvedValueOnce(baseUser({ org: null, dailyLimit: 0, monthlyLimit: 0 }));
    await expect(
      reserveAiQuotaHold({ userId: "u-1", amount: 5, idempotencyKey: "req-1" }),
    ).resolves.toBeNull();

    state.prisma.user.findUnique.mockResolvedValueOnce(
      baseUser({
        org: { id: "org-1", budget: 200, spent: 10 },
      }),
    );
    state.prisma.quotaBucket.findUnique.mockResolvedValueOnce({ limit: 50 });
    state.qmReserve
      .mockResolvedValueOnce({ reservations: [{ id: "d", scope: "USER", subjectId: "u-1", requestId: "d" }] })
      .mockResolvedValueOnce({ reservations: [{ id: "m", scope: "USER", subjectId: "u-1", requestId: "m" }] })
      .mockResolvedValueOnce({ reservations: [{ id: "c", scope: "COST_CENTER", subjectId: "cc-1", requestId: "c" }] })
      .mockResolvedValueOnce({ reservations: [{ id: "o", scope: "ORG", subjectId: "org-1", requestId: "o" }] });

    const hold = await reserveAiQuotaHold({
      userId: "u-1",
      amount: 5,
      idempotencyKey: "req-1",
      costCenterId: "cc-1",
    });

    expect(state.qmReserve).toHaveBeenCalledTimes(4);
    expect(hold).toMatchObject({
      orgId: "org-1",
      idempotencyKey: "req-1",
      costCenterId: "cc-1",
    });
    expect(hold?.daily?.reservations[0]?.id).toBe("d");
    expect(hold?.monthly?.reservations[0]?.id).toBe("m");
    expect(hold?.costCenterBudget?.reservations[0]?.id).toBe("c");
    expect(hold?.orgBudget?.reservations[0]?.id).toBe("o");
  });

  test("reserveAiQuotaHold maps quota failures to legacy daily and monthly errors and rolls back", async () => {
    const { reserveAiQuotaHold } = await loadBilling();

    state.prisma.user.findUnique.mockResolvedValue(
      baseUser({
        org: { id: "org-1", budget: 200, spent: 10 },
      }),
    );

    state.qmReserve.mockRejectedValueOnce(new Error("QUOTA_LIMIT_EXCEEDED"));
    await expect(
      reserveAiQuotaHold({ userId: "u-1", amount: 5, idempotencyKey: "daily" }),
    ).rejects.toThrow("DAILY_LIMIT_EXCEEDED");
    expect(state.qmRelease).not.toHaveBeenCalled();

    state.qmReserve
      .mockResolvedValueOnce({ reservations: [{ id: "d", scope: "USER", subjectId: "u-1", requestId: "d" }] })
      .mockRejectedValueOnce(new Error("QUOTA_LIMIT_EXCEEDED"));

    await expect(
      reserveAiQuotaHold({ userId: "u-1", amount: 5, idempotencyKey: "monthly" }),
    ).rejects.toThrow("MONTHLY_LIMIT_EXCEEDED");
    expect(state.qmRelease).toHaveBeenCalledWith({
      orgId: "org-1",
      reservations: [{ id: "d", scope: "USER", subjectId: "u-1", requestId: "d" }],
    });
  });

  test("reserveAiQuotaHold maps cost center and org quota failures and preserves unknown errors", async () => {
    const { reserveAiQuotaHold } = await loadBilling();

    state.prisma.user.findUnique.mockResolvedValue(
      baseUser({
        dailyLimit: 10,
        monthlyLimit: 20,
        org: { id: "org-1", budget: 100, spent: 10 },
      }),
    );
    state.prisma.quotaBucket.findUnique.mockResolvedValue({ limit: 25 });

    state.qmReserve
      .mockResolvedValueOnce({ reservations: [{ id: "d", scope: "USER", subjectId: "u-1", requestId: "d" }] })
      .mockResolvedValueOnce({ reservations: [{ id: "m", scope: "USER", subjectId: "u-1", requestId: "m" }] })
      .mockRejectedValueOnce(new Error("QUOTA_LIMIT_EXCEEDED"));

    await expect(
      reserveAiQuotaHold({ userId: "u-1", amount: 5, idempotencyKey: "cc", costCenterId: "cc-1" }),
    ).rejects.toThrow("COST_CENTER_BUDGET_EXCEEDED");

    state.qmReserve
      .mockResolvedValueOnce({ reservations: [{ id: "d2", scope: "USER", subjectId: "u-1", requestId: "d2" }] })
      .mockResolvedValueOnce({ reservations: [{ id: "m2", scope: "USER", subjectId: "u-1", requestId: "m2" }] })
      .mockResolvedValueOnce({ reservations: [{ id: "c2", scope: "COST_CENTER", subjectId: "cc-1", requestId: "c2" }] })
      .mockRejectedValueOnce(new Error("QUOTA_LIMIT_EXCEEDED"));

    await expect(
      reserveAiQuotaHold({ userId: "u-1", amount: 5, idempotencyKey: "org", costCenterId: "cc-1" }),
    ).rejects.toThrow("ORG_BUDGET_EXCEEDED");

    state.qmReserve.mockRejectedValueOnce(new Error("boom"));
    await expect(
      reserveAiQuotaHold({ userId: "u-1", amount: 5, idempotencyKey: "boom" }),
    ).rejects.toThrow("boom");
  });

  test("reserveAiQuotaHold ignores rollback failures while surfacing the original error", async () => {
    const { reserveAiQuotaHold } = await loadBilling();

    state.prisma.user.findUnique.mockResolvedValueOnce(
      baseUser({
        org: { id: "org-1", budget: 0, spent: 0 },
        monthlyLimit: 20,
      }),
    );
    state.qmReserve
      .mockResolvedValueOnce({ reservations: [{ id: "d", scope: "USER", subjectId: "u-1", requestId: "d" }] })
      .mockRejectedValueOnce(new Error("boom"));
    state.qmRelease.mockRejectedValueOnce(new Error("rollback failed"));

    await expect(
      reserveAiQuotaHold({ userId: "u-1", amount: 5, idempotencyKey: "boom-rollback" }),
    ).rejects.toThrow("boom");
  });

  test("reserveAiQuotaHold skips disabled cost center and org budgets", async () => {
    const { reserveAiQuotaHold } = await loadBilling();

    state.prisma.user.findUnique.mockResolvedValueOnce(
      baseUser({
        dailyLimit: 0,
        monthlyLimit: 0,
        org: { id: "org-1", budget: 0, spent: 0 },
      }),
    );
    state.prisma.quotaBucket.findUnique.mockResolvedValueOnce({ limit: 0 });

    const hold = await reserveAiQuotaHold({
      userId: "u-1",
      amount: 5,
      idempotencyKey: "skip-budget",
      costCenterId: "cc-1",
    });

    expect(state.qmReserve).not.toHaveBeenCalled();
    expect(hold).toEqual({
      orgId: "org-1",
      idempotencyKey: "skip-budget",
      costCenterId: "cc-1",
    });
  });

  test("reserveAiQuotaHold can reserve only org budget and rethrows non-Error values", async () => {
    const { reserveAiQuotaHold } = await loadBilling();

    state.prisma.user.findUnique.mockResolvedValueOnce(
      baseUser({
        dailyLimit: 0,
        monthlyLimit: 0,
        org: { id: "org-1", budget: 25, spent: 5 },
      }),
    );
    state.qmReserve.mockResolvedValueOnce({
      reservations: [{ id: "o", scope: "ORG", subjectId: "org-1", requestId: "o" }],
    });

    const hold = await reserveAiQuotaHold({
      userId: "u-1",
      amount: 5,
      idempotencyKey: "org-only",
    });

    expect(state.qmReserve).toHaveBeenCalledTimes(1);
    expect(hold?.orgBudget?.reservations[0]?.id).toBe("o");

    state.prisma.user.findUnique.mockResolvedValueOnce(
      baseUser({
        org: { id: "org-1", budget: 25, spent: 5 },
      }),
    );
    state.qmReserve.mockRejectedValueOnce("string-error");

    await expect(
      reserveAiQuotaHold({ userId: "u-1", amount: 5, idempotencyKey: "string-error" }),
    ).rejects.toBe("string-error");
  });

  test("reserveAiQuotaHold handles nullish counters, resets and cost-center bucket lookups", async () => {
    const { reserveAiQuotaHold } = await loadBilling();

    state.prisma.user.findUnique.mockResolvedValueOnce({
      balance: 10,
      dailyLimit: null,
      monthlyLimit: null,
      dailySpent: null,
      monthlySpent: null,
      dailyResetAt: null,
      monthlyResetAt: null,
      org: { id: "org-1", budget: null, spent: null },
    });
    state.prisma.quotaBucket.findUnique.mockResolvedValueOnce(null);

    const hold = await reserveAiQuotaHold({
      userId: "u-1",
      amount: 5,
      idempotencyKey: "nullish",
      costCenterId: "cc-1",
    });

    expect(state.qmReserve).not.toHaveBeenCalled();
    expect(hold).toEqual({
      orgId: "org-1",
      idempotencyKey: "nullish",
      costCenterId: "cc-1",
    });
  });

  test("commitAiQuotaHold and releaseAiQuotaHold short-circuit empty inputs and fan out reservations", async () => {
    const { commitAiQuotaHold, releaseAiQuotaHold } = await loadBilling();

    await expect(commitAiQuotaHold({ hold: null, finalAmount: 5 })).resolves.toBeUndefined();
    await expect(releaseAiQuotaHold({ hold: null })).resolves.toBeUndefined();

    const hold = {
      orgId: "org-1",
      idempotencyKey: "req-1",
      daily: { reservations: [{ id: "d", scope: "USER", subjectId: "u-1", requestId: "d" }] },
      monthly: { reservations: [{ id: "m", scope: "USER", subjectId: "u-1", requestId: "m" }] },
      costCenterBudget: { reservations: [{ id: "c", scope: "COST_CENTER", subjectId: "cc-1", requestId: "c" }] },
      orgBudget: { reservations: [{ id: "o", scope: "ORG", subjectId: "org-1", requestId: "o" }] },
    };

    await commitAiQuotaHold({ hold, finalAmount: 9 });
    expect(state.qmCommit).toHaveBeenCalledTimes(4);

    await releaseAiQuotaHold({ hold: { orgId: "org-1", idempotencyKey: "empty" } as any });
    expect(state.qmRelease).toHaveBeenCalledTimes(0);

    await releaseAiQuotaHold({ hold });
    expect(state.qmRelease).toHaveBeenCalledWith({
      orgId: "org-1",
      reservations: [
        { id: "d", scope: "USER", subjectId: "u-1", requestId: "d" },
        { id: "m", scope: "USER", subjectId: "u-1", requestId: "m" },
        { id: "c", scope: "COST_CENTER", subjectId: "cc-1", requestId: "c" },
        { id: "o", scope: "ORG", subjectId: "org-1", requestId: "o" },
      ],
    });
  });
});
