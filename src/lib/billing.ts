import { prisma } from "@/lib/db";
import { applyLimitResets } from "@/lib/limits";
import {
  QuotaManager,
  getAllTimePeriod,
  getUtcDayPeriod,
  getUtcMonthPeriod,
} from "@/lib/quota-manager";
import type { QuotaReserveResult } from "@/lib/quota-manager";

export async function preflightCredits(params: {
  userId: string;
  minAmount?: number;
}) {
  const minAmount = params.minAmount ?? 1;
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: {
      balance: true,
      dailyLimit: true,
      monthlyLimit: true,
      dailySpent: true,
      monthlySpent: true,
      dailyResetAt: true,
      monthlyResetAt: true,
      org: {
        select: {
          budget: true,
          spent: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  const currentBalance = user.balance ?? 0;
  if (Number(currentBalance) < minAmount) {
    throw new Error("INSUFFICIENT_BALANCE");
  }

  const resets = applyLimitResets({
    dailySpent: Number(user.dailySpent ?? 0),
    monthlySpent: Number(user.monthlySpent ?? 0),
    dailyResetAt: user.dailyResetAt ?? new Date(),
    monthlyResetAt: user.monthlyResetAt ?? new Date(),
  });

  const nextDailySpent = resets.dailySpent + minAmount;
  const nextMonthlySpent = resets.monthlySpent + minAmount;

  if (
    user.dailyLimit &&
    Number(user.dailyLimit) > 0 &&
    nextDailySpent > Number(user.dailyLimit)
  ) {
    throw new Error("DAILY_LIMIT_EXCEEDED");
  }

  if (
    user.monthlyLimit &&
    Number(user.monthlyLimit) > 0 &&
    nextMonthlySpent > Number(user.monthlyLimit)
  ) {
    throw new Error("MONTHLY_LIMIT_EXCEEDED");
  }

  if (user.org && Number(user.org.budget) > 0) {
    const nextOrgSpent = Number(user.org.spent) + minAmount;
    if (nextOrgSpent > Number(user.org.budget)) {
      throw new Error("ORG_BUDGET_EXCEEDED");
    }
  }
}

export async function spendCredits(params: {
  userId: string;
  amount: number;
  description?: string;
  costCenterId?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const user = await tx.user.findUnique({
      where: { id: params.userId },
      select: {
        balance: true,
        dailyLimit: true,
        monthlyLimit: true,
        dailySpent: true,
        monthlySpent: true,
        dailyResetAt: true,
        monthlyResetAt: true,
        costCenterId: true,
        org: {
          select: {
            id: true,
            budget: true,
            spent: true,
          },
        },
      },
    });

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const currentBalance = user.balance ?? 0;
    if (Number(currentBalance) < params.amount) {
      throw new Error("INSUFFICIENT_BALANCE");
    }

    const resets = applyLimitResets({
      dailySpent: Number(user.dailySpent ?? 0),
      monthlySpent: Number(user.monthlySpent ?? 0),
      dailyResetAt: user.dailyResetAt ?? now,
      monthlyResetAt: user.monthlyResetAt ?? now,
    });

    const wouldBeDailySpent = resets.dailySpent + params.amount;
    const wouldBeMonthlySpent = resets.monthlySpent + params.amount;

    if (
      user.dailyLimit &&
      Number(user.dailyLimit) > 0 &&
      wouldBeDailySpent > Number(user.dailyLimit)
    ) {
      throw new Error("DAILY_LIMIT_EXCEEDED");
    }

    if (
      user.monthlyLimit &&
      Number(user.monthlyLimit) > 0 &&
      wouldBeMonthlySpent > Number(user.monthlyLimit)
    ) {
      throw new Error("MONTHLY_LIMIT_EXCEEDED");
    }

    if (user.org && Number(user.org.budget) > 0) {
      const nextOrgSpent = Number(user.org.spent) + params.amount;
      if (nextOrgSpent > Number(user.org.budget)) {
        throw new Error("ORG_BUDGET_EXCEEDED");
      }
    }

    const effectiveCostCenterId =
      params.costCenterId ?? (user.org ? undefined : user.costCenterId ?? undefined);

    const transaction = await tx.transaction.create({
      data: {
        userId: params.userId,
        costCenterId: effectiveCostCenterId,
        amount: params.amount,
        type: "SPEND",
        description: params.description ?? "Списание за запрос",
      },
    });

    const updated = await tx.user.update({
      where: {
        id: params.userId,
        balance: { gte: params.amount },
      },
      data: {
        balance: { decrement: params.amount },
        dailySpent:
          resets.dailyResetAt.getTime() !== (user.dailyResetAt ?? new Date(0)).getTime()
            ? wouldBeDailySpent
            : { increment: params.amount },
        monthlySpent:
          resets.monthlyResetAt.getTime() !== (user.monthlyResetAt ?? new Date(0)).getTime()
            ? wouldBeMonthlySpent
            : { increment: params.amount },
        dailyResetAt: resets.dailyResetAt,
        monthlyResetAt: resets.monthlyResetAt,
      },
      select: { balance: true },
    }).catch((e) => {
      if (e.code === "P2025") {
        throw new Error("INSUFFICIENT_BALANCE");
      }
      throw e;
    });

    if (user.org) {
      await tx.organization.update({
        where: { id: user.org.id },
        data: { spent: { increment: params.amount } },
      });

      // Keep quota buckets in sync for org-scoped users.
      const dayPeriod = getUtcDayPeriod(now);
      const monthPeriod = getUtcMonthPeriod(now);
      const allTime = getAllTimePeriod();

      await tx.quotaBucket.upsert({
        where: {
          scope_subjectId_periodStart_periodEnd: {
            scope: "USER",
            subjectId: params.userId,
            periodStart: dayPeriod.start,
            periodEnd: dayPeriod.end,
          },
        },
        create: {
          orgId: user.org.id,
          scope: "USER",
          subjectId: params.userId,
          periodStart: dayPeriod.start,
          periodEnd: dayPeriod.end,
          limit: Number(user.dailyLimit ?? 0),
          spent: wouldBeDailySpent,
          reserved: 0,
        },
        update: {
          limit: Number(user.dailyLimit ?? 0),
          spent: { increment: params.amount },
        },
      });

      await tx.quotaBucket.upsert({
        where: {
          scope_subjectId_periodStart_periodEnd: {
            scope: "USER",
            subjectId: params.userId,
            periodStart: monthPeriod.start,
            periodEnd: monthPeriod.end,
          },
        },
        create: {
          orgId: user.org.id,
          scope: "USER",
          subjectId: params.userId,
          periodStart: monthPeriod.start,
          periodEnd: monthPeriod.end,
          limit: Number(user.monthlyLimit ?? 0),
          spent: wouldBeMonthlySpent,
          reserved: 0,
        },
        update: {
          limit: Number(user.monthlyLimit ?? 0),
          spent: { increment: params.amount },
        },
      });

      await tx.quotaBucket.upsert({
        where: {
          scope_subjectId_periodStart_periodEnd: {
            scope: "ORG",
            subjectId: user.org.id,
            periodStart: allTime.start,
            periodEnd: allTime.end,
          },
        },
        create: {
          orgId: user.org.id,
          scope: "ORG",
          subjectId: user.org.id,
          periodStart: allTime.start,
          periodEnd: allTime.end,
          limit: Number(user.org.budget ?? 0),
          spent: Number(user.org.spent ?? 0) + params.amount,
          reserved: 0,
        },
        update: {
          limit: Number(user.org.budget ?? 0),
          spent: { increment: params.amount },
        },
      });

      if (effectiveCostCenterId) {
        await tx.quotaBucket.upsert({
          where: {
            scope_subjectId_periodStart_periodEnd: {
              scope: "COST_CENTER",
              subjectId: effectiveCostCenterId,
              periodStart: allTime.start,
              periodEnd: allTime.end,
            },
          },
          create: {
            orgId: user.org.id,
            scope: "COST_CENTER",
            subjectId: effectiveCostCenterId,
            periodStart: allTime.start,
            periodEnd: allTime.end,
            limit: 0,
            spent: params.amount,
            reserved: 0,
          },
          update: {
            spent: { increment: params.amount },
          },
        });
      }
    }

    return { transaction, balance: updated.balance };
  });
}

export type AiQuotaHold = {
  orgId: string;
  idempotencyKey: string;
  costCenterId?: string;
  daily?: QuotaReserveResult;
  monthly?: QuotaReserveResult;
  costCenterBudget?: QuotaReserveResult;
  orgBudget?: QuotaReserveResult;
};

export async function reserveAiQuotaHold(params: {
  userId: string;
  amount: number;
  idempotencyKey: string;
  costCenterId?: string;
}): Promise<AiQuotaHold | null> {
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: {
      balance: true,
      dailyLimit: true,
      monthlyLimit: true,
      dailySpent: true,
      monthlySpent: true,
      dailyResetAt: true,
      monthlyResetAt: true,
      org: {
        select: { id: true, budget: true, spent: true },
      },
    },
  });

  if (!user) throw new Error("USER_NOT_FOUND");

  const currentBalance = user.balance ?? 0;
  if (Number(currentBalance) < params.amount) {
    throw new Error("INSUFFICIENT_BALANCE");
  }

  if (!user.org) {
    // Reservations are org-scoped in the current schema.
    return null;
  }

  const now = new Date();
  const resets = applyLimitResets({
    dailySpent: Number(user.dailySpent ?? 0),
    monthlySpent: Number(user.monthlySpent ?? 0),
    dailyResetAt: user.dailyResetAt ?? now,
    monthlyResetAt: user.monthlyResetAt ?? now,
  });

  const qm = new QuotaManager();
  const hold: AiQuotaHold = { orgId: user.org.id, idempotencyKey: params.idempotencyKey, costCenterId: params.costCenterId };
  let costCenterBudgetEnabled = false;

  try {
    const dayPeriod = getUtcDayPeriod(now);
    const monthPeriod = getUtcMonthPeriod(now);
    const allTime = getAllTimePeriod();

    if (params.costCenterId) {
      const bucket = await prisma.quotaBucket.findUnique({
        where: {
          scope_subjectId_periodStart_periodEnd: {
            scope: "COST_CENTER",
            subjectId: params.costCenterId,
            periodStart: allTime.start,
            periodEnd: allTime.end,
          },
        },
        select: { limit: true },
      });

      costCenterBudgetEnabled = Number(bucket?.limit ?? 0) > 0;
    }

    if (user.dailyLimit && Number(user.dailyLimit) > 0) {
      hold.daily = await qm.reserve({
        chain: {
          orgId: user.org.id,
          subjects: [{ scope: "USER", subjectId: params.userId }],
        },
        period: dayPeriod,
        amount: params.amount,
        idempotencyKey: params.idempotencyKey,
        bucketStateBySubject: {
          [`USER:${params.userId}`]: {
            limit: Number(user.dailyLimit),
            spent: resets.dailySpent,
          },
        },
      });
    }

    if (user.monthlyLimit && Number(user.monthlyLimit) > 0) {
      hold.monthly = await qm.reserve({
        chain: {
          orgId: user.org.id,
          subjects: [{ scope: "USER", subjectId: params.userId }],
        },
        period: monthPeriod,
        amount: params.amount,
        idempotencyKey: params.idempotencyKey,
        bucketStateBySubject: {
          [`USER:${params.userId}`]: {
            limit: Number(user.monthlyLimit),
            spent: resets.monthlySpent,
          },
        },
      });
    }

    if (costCenterBudgetEnabled && params.costCenterId) {
      hold.costCenterBudget = await qm.reserve({
        chain: {
          orgId: user.org.id,
          subjects: [{ scope: "COST_CENTER", subjectId: params.costCenterId }],
        },
        period: allTime,
        amount: params.amount,
        idempotencyKey: params.idempotencyKey,
      });
    }

    if (Number(user.org.budget ?? 0) > 0) {
      hold.orgBudget = await qm.reserve({
        chain: {
          orgId: user.org.id,
          subjects: [{ scope: "ORG", subjectId: user.org.id }],
        },
        period: allTime,
        amount: params.amount,
        idempotencyKey: params.idempotencyKey,
        bucketStateBySubject: {
          [`ORG:${user.org.id}`]: {
            limit: Number(user.org.budget ?? 0),
            spent: Number(user.org.spent ?? 0),
          },
        },
      });
    }

    return hold;
  } catch (err) {
    // Best-effort rollback.
    const reservations = [
      ...(hold.daily?.reservations ?? []),
      ...(hold.monthly?.reservations ?? []),
      ...(hold.costCenterBudget?.reservations ?? []),
      ...(hold.orgBudget?.reservations ?? []),
    ];

    if (reservations.length > 0) {
      try {
        await qm.release({ orgId: hold.orgId, reservations });
      } catch {
        // ignore rollback errors
      }
    }

    if (err instanceof Error && err.message === "QUOTA_LIMIT_EXCEEDED") {
      // This error originates from QuotaManager reserve checks.
      // Since we reserve the same amount for each constraint, prefer consistent legacy error names.
      // If multiple constraints exist, the first failing reservation wins.
      if (hold.daily === undefined && user.dailyLimit && Number(user.dailyLimit) > 0) {
        throw new Error("DAILY_LIMIT_EXCEEDED");
      }
      if (hold.monthly === undefined && user.monthlyLimit && Number(user.monthlyLimit) > 0) {
        throw new Error("MONTHLY_LIMIT_EXCEEDED");
      }
      if (hold.costCenterBudget === undefined && costCenterBudgetEnabled) {
        throw new Error("COST_CENTER_BUDGET_EXCEEDED");
      }
      if (hold.orgBudget === undefined && Number(user.org.budget ?? 0) > 0) {
        throw new Error("ORG_BUDGET_EXCEEDED");
      }
    }

    throw err;
  }
}

export async function commitAiQuotaHold(params: {
  hold: AiQuotaHold | null;
  finalAmount: number;
}): Promise<void> {
  if (!params.hold) return;

  const qm = new QuotaManager();
  if (params.hold.daily) {
    await qm.commit({
      orgId: params.hold.orgId,
      reservations: params.hold.daily.reservations,
      finalAmount: params.finalAmount,
    });
  }
  if (params.hold.monthly) {
    await qm.commit({
      orgId: params.hold.orgId,
      reservations: params.hold.monthly.reservations,
      finalAmount: params.finalAmount,
    });
  }
  if (params.hold.costCenterBudget) {
    await qm.commit({
      orgId: params.hold.orgId,
      reservations: params.hold.costCenterBudget.reservations,
      finalAmount: params.finalAmount,
    });
  }
  if (params.hold.orgBudget) {
    await qm.commit({
      orgId: params.hold.orgId,
      reservations: params.hold.orgBudget.reservations,
      finalAmount: params.finalAmount,
    });
  }
}

export async function releaseAiQuotaHold(params: {
  hold: AiQuotaHold | null;
}): Promise<void> {
  if (!params.hold) return;

  const reservations = [
    ...(params.hold.daily?.reservations ?? []),
    ...(params.hold.monthly?.reservations ?? []),
    ...(params.hold.costCenterBudget?.reservations ?? []),
    ...(params.hold.orgBudget?.reservations ?? []),
  ];

  if (reservations.length === 0) return;

  const qm = new QuotaManager();
  await qm.release({ orgId: params.hold.orgId, reservations });
}
