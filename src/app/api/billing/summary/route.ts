import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { applyLimitResets } from "@/lib/limits";
import { getIncludedCreditsRemaining } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      balance: true,
      dailySpent: true,
      monthlySpent: true,
      dailyLimit: true,
      monthlyLimit: true,
      dailyResetAt: true,
      monthlyResetAt: true,
      subscription: {
        select: {
          status: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          includedCredits: true,
          includedCreditsUsed: true,
          cancelAtPeriodEnd: true,
          plan: {
            select: {
              code: true,
              name: true,
              monthlyPriceUsd: true,
              includedCreditsPerMonth: true,
            },
          },
        },
      },
      org: {
        select: {
          budget: true,
          spent: true,
        },
      },
    },
  });

  let effectiveDailySpent = user?.dailySpent ?? 0;
  let effectiveMonthlySpent = user?.monthlySpent ?? 0;

  if (user) {
    const resets = applyLimitResets({
      dailySpent: Number(user.dailySpent ?? 0),
      monthlySpent: Number(user.monthlySpent ?? 0),
      dailyResetAt: user.dailyResetAt ?? new Date(),
      monthlyResetAt: user.monthlyResetAt ?? new Date(),
    });

    effectiveDailySpent = resets.dailySpent;
    effectiveMonthlySpent = resets.monthlySpent;

    if (
      resets.dailySpent !== Number(user.dailySpent ?? 0) ||
      resets.monthlySpent !== Number(user.monthlySpent ?? 0)
    ) {
      await prisma.user.update({
        where: { id: session.user.id },
        data: {
          dailySpent: resets.dailySpent,
          monthlySpent: resets.monthlySpent,
          dailyResetAt: resets.dailyResetAt,
          monthlyResetAt: resets.monthlyResetAt,
        },
      });
    }
  }

  const transactions = await prisma.transaction.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const serializedTransactions = transactions.map((transaction) => ({
    ...transaction,
    amount: transaction.amount.toString(),
  }));

  return NextResponse.json({
    balance: user?.balance?.toString() ?? "0",
    topUpBalance: user?.balance?.toString() ?? "0",
    includedCreditsRemaining: getIncludedCreditsRemaining(user?.subscription).toString(),
    dailySpent: effectiveDailySpent.toString(),
    monthlySpent: effectiveMonthlySpent.toString(),
    dailyLimit: user?.dailyLimit?.toString() ?? null,
    monthlyLimit: user?.monthlyLimit?.toString() ?? null,
    subscription: user?.subscription
      ? {
          status: user.subscription.status,
          currentPeriodStart: user.subscription.currentPeriodStart.toISOString(),
          currentPeriodEnd: user.subscription.currentPeriodEnd.toISOString(),
          includedCredits: user.subscription.includedCredits.toString(),
          includedCreditsUsed: user.subscription.includedCreditsUsed.toString(),
          cancelAtPeriodEnd: user.subscription.cancelAtPeriodEnd,
          plan: {
            code: user.subscription.plan.code,
            name: user.subscription.plan.name,
            monthlyPriceUsd: user.subscription.plan.monthlyPriceUsd.toString(),
            includedCreditsPerMonth:
              user.subscription.plan.includedCreditsPerMonth.toString(),
          },
        }
      : null,
    org: user?.org
      ? {
          budget: user.org.budget.toString(),
          spent: user.org.spent.toString(),
        }
      : null,
    transactions: serializedTransactions,
  });
}
