import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { applyLimitResets } from "@/lib/limits";
import {
  DEFAULT_BILLING_MARKUP,
  formatCredits,
  formatCreditsLabel,
  formatSignedCredits,
  formatTransactionDirection,
} from "@/lib/billing-display";

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
    amountLabel: formatSignedCredits(
      transaction.amount.toString(),
      transaction.type === "REFILL" ? "+" : "-"
    ),
    direction: formatTransactionDirection(transaction.type),
  }));

  return NextResponse.json({
    markup: DEFAULT_BILLING_MARKUP,
    balance: user?.balance?.toString() ?? "0",
    balanceLabel: formatCreditsLabel(user?.balance?.toString() ?? "0"),
    dailySpent: effectiveDailySpent.toString(),
    dailySpentLabel: formatCreditsLabel(effectiveDailySpent.toString()),
    monthlySpent: effectiveMonthlySpent.toString(),
    monthlySpentLabel: formatCreditsLabel(effectiveMonthlySpent.toString()),
    dailyLimit: user?.dailyLimit?.toString() ?? null,
    monthlyLimit: user?.monthlyLimit?.toString() ?? null,
    org: user?.org
      ? {
          budget: user.org.budget.toString(),
          spent: user.org.spent.toString(),
          spentLabel: formatCreditsLabel(user.org.spent.toString()),
        }
      : null,
    transactions: serializedTransactions,
  });
}
