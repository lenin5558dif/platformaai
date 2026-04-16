import { prisma } from "@/lib/db";
import {
  formatCredits,
  formatCreditsLabel,
  formatSignedCredits,
  formatTransactionDirection,
} from "@/lib/billing-display";

export const dynamic = "force-dynamic";

type TransactionRow = {
  id: string;
  amount: string;
  type: "REFILL" | "SPEND";
  description: string;
  createdAt: Date;
  user: {
    email: string | null;
  };
};

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "0";
  }
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatDate(value: Date | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export default async function AdminBillingPage() {
  const [usersTotal, usersActive, totalBalance, refillsTotal, spendsTotal, recentTransactions] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.aggregate({
        _sum: { balance: true },
      }),
      prisma.transaction.aggregate({
        where: { type: "REFILL" },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.transaction.aggregate({
        where: { type: "SPEND" },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.transaction.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          amount: true,
          type: true,
          description: true,
          createdAt: true,
          user: {
            select: {
              email: true,
            },
          },
        },
      }),
    ]);

  const transactions: TransactionRow[] = recentTransactions.map((transaction) => ({
    ...transaction,
    amount: transaction.amount.toString(),
  }));

  const totalBalanceValue = Number(totalBalance._sum.balance ?? 0);
  const refillsValue = Number(refillsTotal._sum.amount ?? 0);
  const spendsValue = Number(spendsTotal._sum.amount ?? 0);
  const netFlow = refillsValue - spendsValue;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
        <h1 className="text-2xl font-semibold text-text-main font-display">
          Биллинг
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Сводка по деньгам, балансу и последним движениям средств.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/50 bg-white/80 p-5 shadow-glass-sm transition-shadow motion-safe:duration-150 hover:shadow-md">
          <p className="text-xs text-text-secondary">Клиенты</p>
          <p className="text-2xl font-semibold text-text-main">
            {formatNumber(usersTotal)}
          </p>
          <p className="mt-1 text-xs text-text-secondary">
            Активных: {formatNumber(usersActive)}
          </p>
        </div>
        <div className="rounded-2xl border border-white/50 bg-white/80 p-5 shadow-glass-sm transition-shadow motion-safe:duration-150 hover:shadow-md">
          <p className="text-xs text-text-secondary">Общий баланс</p>
          <p className="text-2xl font-semibold text-text-main">
            {formatCredits(totalBalanceValue)}
          </p>
          <p className="mt-1 text-xs text-text-secondary">
            {formatCreditsLabel(totalBalanceValue)}
          </p>
        </div>
        <div className="rounded-2xl border border-white/50 bg-white/80 p-5 shadow-glass-sm transition-shadow motion-safe:duration-150 hover:shadow-md">
          <p className="text-xs text-text-secondary">Пополнения</p>
          <p className="text-2xl font-semibold text-text-main">
            {formatCredits(refillsValue)}
          </p>
          <p className="mt-1 text-xs text-text-secondary">
            Транзакций: {formatNumber(refillsTotal._count._all)}
          </p>
        </div>
        <div className="rounded-2xl border border-white/50 bg-white/80 p-5 shadow-glass-sm transition-shadow motion-safe:duration-150 hover:shadow-md">
          <p className="text-xs text-text-secondary">Списания</p>
          <p className="text-2xl font-semibold text-text-main">
            {formatCredits(spendsValue)}
          </p>
          <p className="mt-1 text-xs text-text-secondary">
            Чистый поток: {formatCredits(netFlow)}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/50 bg-white/80 p-6 shadow-glass-sm transition-shadow motion-safe:duration-150 hover:shadow-md">
        <h2 className="text-lg font-semibold text-text-main font-display">
          Последние транзакции
        </h2>
        {transactions.length === 0 ? (
          <p className="mt-4 text-sm text-text-secondary">Транзакций пока нет.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-secondary">
                  <th className="pb-3 pr-3">Клиент</th>
                  <th className="pb-3 pr-3">Тип</th>
                  <th className="pb-3 pr-3">Сумма</th>
                  <th className="pb-3 pr-3">Описание</th>
                  <th className="pb-3">Дата</th>
                </tr>
              </thead>
              <tbody className="text-text-main">
                {transactions.map((transaction) => (
                  <tr key={transaction.id} className="border-t border-white/40">
                    <td className="py-3 pr-3">
                      {transaction.user.email ?? transaction.id}
                    </td>
                    <td className="py-3 pr-3">
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                          transaction.type === "REFILL"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {formatTransactionDirection(transaction.type)}
                      </span>
                    </td>
                    <td className="py-3 pr-3 font-medium">
                      {formatSignedCredits(
                        transaction.amount,
                        transaction.type === "REFILL" ? "+" : "-"
                      )}
                    </td>
                    <td className="py-3 pr-3 text-text-secondary">
                      {transaction.description}
                    </td>
                    <td className="py-3 text-text-secondary">
                      {formatDate(transaction.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
