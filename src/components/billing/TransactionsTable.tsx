"use client";

import { useMemo, useState } from "react";

type BillingTransaction = {
  id: string;
  createdAt: string;
  description: string;
  amount: string;
  type: "REFILL" | "SPEND";
};

type TransactionsTableProps = {
  transactions: BillingTransaction[];
};

function formatCredits(value: number) {
  const formatter = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${formatter.format(value)} кр.`;
}

export default function TransactionsTable({ transactions }: TransactionsTableProps) {
  const [filter, setFilter] = useState<"ALL" | "REFILL" | "SPEND">("ALL");
  const [visibleCount, setVisibleCount] = useState(10);

  const filteredTransactions = useMemo(() => {
    if (filter === "ALL") return transactions;
    return transactions.filter((transaction) => transaction.type === filter);
  }, [filter, transactions]);

  const visibleTransactions = filteredTransactions.slice(0, visibleCount);
  const canShowMore = visibleCount < filteredTransactions.length;

  function downloadReceipt(transaction: BillingTransaction) {
    const amount = Number(transaction.amount ?? 0);
    const sign = transaction.type === "REFILL" ? "+" : "-";
    const content = [
      "PlatformaAI Billing Receipt",
      `Transaction: ${transaction.id}`,
      `Date: ${new Date(transaction.createdAt).toISOString()}`,
      `Type: ${transaction.type}`,
      `Description: ${transaction.description}`,
      `Amount: ${sign}${amount.toFixed(2)} credits`,
    ].join("\n");

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `receipt-${transaction.id}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div id="payment-history" className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold text-slate-900">
          История платежей
        </h3>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="material-symbols-outlined text-[18px]">filter_list</span>
          <select
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value as "ALL" | "REFILL" | "SPEND");
              setVisibleCount(10);
            }}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900"
            aria-label="Фильтр платежей"
          >
            <option value="ALL">Все</option>
            <option value="REFILL">Пополнения</option>
            <option value="SPEND">Списания</option>
          </select>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                <th className="whitespace-nowrap px-6 py-3 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Дата
                </th>
                <th className="whitespace-nowrap px-6 py-3 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Описание
                </th>
                <th className="whitespace-nowrap px-6 py-3 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Сумма
                </th>
                <th className="whitespace-nowrap px-6 py-3 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Статус
                </th>
                <th className="whitespace-nowrap px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500">
                  Чек
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {visibleTransactions.length === 0 && (
                <tr>
                  <td className="px-6 py-6 text-center text-sm text-slate-500" colSpan={5}>
                    История платежей появится после первых операций.
                  </td>
                </tr>
              )}
              {visibleTransactions.map((transaction) => {
                const amount = Number(transaction.amount ?? 0);
                const isRefill = transaction.type === "REFILL";
                return (
                  <tr key={transaction.id} className="group transition-colors hover:bg-slate-50">
                    <td className="whitespace-nowrap px-6 py-4 text-slate-900">
                      {new Date(transaction.createdAt).toLocaleDateString("ru-RU", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 font-medium text-slate-900">
                      {transaction.description}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-slate-900">
                      {isRefill ? "+" : "-"}
                      {formatCredits(amount)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span
                        className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${
                          isRefill
                            ? "border-green-200 bg-green-50 text-green-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}
                      >
                        {isRefill ? "Оплачено" : "Списание"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => downloadReceipt(transaction)}
                        className="rounded p-1 text-slate-400 transition-colors hover:bg-primary/5 hover:text-primary"
                        aria-label="Скачать чек"
                      >
                        <span className="material-symbols-outlined text-[20px]">download</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex justify-center border-t border-slate-200 bg-slate-50/50 px-6 py-3">
          <button
            type="button"
            className="text-sm font-medium text-primary transition-colors hover:text-primary/80 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
            onClick={() => setVisibleCount((prev) => prev + 10)}
            disabled={!canShowMore}
          >
            {canShowMore ? "Показать больше" : "Больше записей нет"}
          </button>
        </div>
      </div>
    </div>
  );
}
