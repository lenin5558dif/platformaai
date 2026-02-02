import { prisma } from "@/lib/db";
import { applyLimitResets } from "@/lib/limits";

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
      dailyResetAt: user.dailyResetAt ?? new Date(),
      monthlyResetAt: user.monthlyResetAt ?? new Date(),
    });

    const nextDailySpent = resets.dailySpent + params.amount;
    const nextMonthlySpent = resets.monthlySpent + params.amount;

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
        dailySpent: nextDailySpent,
        monthlySpent: nextMonthlySpent,
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
    }

    return { transaction, balance: updated.balance };
  });
}
