import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { requirePageSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSettingsObject } from "@/lib/user-settings";
import TopUpForm from "@/components/billing/TopUpForm";
import { resolvePlanFromSettings } from "@/lib/plans";

export const dynamic = "force-dynamic";

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatCredits(value: number) {
  const formatter = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${formatter.format(value)} кр.`;
}

export default async function BillingPage() {
  const session = await requirePageSession();

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const [user, usage, transactions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { balance: true, email: true, settings: true, orgId: true, role: true },
    }),
    prisma.message.aggregate({
      where: {
        userId: session.user.id,
        role: "ASSISTANT",
        createdAt: { gte: monthStart, lt: monthEnd },
      },
      _sum: { tokenCount: true, cost: true },
      _count: { _all: true },
    }),
    prisma.transaction.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const org = user?.orgId
    ? await prisma.organization.findUnique({
        where: { id: user.orgId },
      })
    : null;

  const settings = getSettingsObject(user?.settings ?? null);
  const resolvedPlan = resolvePlanFromSettings(settings);
  const isB2B = user?.role && user.role !== "USER";
  const isAdmin = user?.role === "ADMIN";

  const usedTokens = Number(usage._sum?.tokenCount ?? 0);
  const spentCredits = Number(usage._sum?.cost ?? 0);
  const includedCredits = resolvedPlan?.includedCreditsPerMonth ?? null;
  const creditPercent =
    includedCredits && includedCredits > 0
      ? Math.min(100, (spentCredits / includedCredits) * 100)
      : 0;

  const orgSettings = getSettingsObject(org?.settings ?? null);
  const orgCompany =
    typeof orgSettings.companyName === "string"
      ? orgSettings.companyName
      : org?.name ?? "";
  const orgTaxId =
    typeof orgSettings.taxId === "string" ? orgSettings.taxId : "";
  const orgAddress =
    typeof orgSettings.address === "string" ? orgSettings.address : "";

  return (
    <AppShell
      title="Биллинг"
      subtitle="Управляйте тарифом, лимитами и платежами."
      user={{
        email: user?.email,
        role: user?.role,
        planName: resolvedPlan?.name ?? null,
      }}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
              <div className="flex flex-col gap-6">
                <nav className="flex items-center text-sm font-medium text-slate-500">
                  <Link className="transition-colors hover:text-primary" href="/">
                    Главная
                  </Link>
                  <span className="mx-2 text-slate-300">/</span>
                  <Link className="transition-colors hover:text-primary" href="/settings">
                    Аккаунт
                  </Link>
                  <span className="mx-2 text-slate-300">/</span>
                  <span className="text-slate-900">Биллинг</span>
                </nav>
                <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                  <div className="flex flex-col gap-1">
                    <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900">
                      Подписка и платежи
                    </h1>
                    <p className="text-slate-500">
                      Управляйте тарифом, лимитами и способами оплаты.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-medium text-slate-400 shadow-sm"
                      disabled
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[18px] text-slate-500">
                        description
                      </span>
                      Инвойсы скоро
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:col-span-2">
                  <div className="flex h-full flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between md:p-8">
                    <div className="flex flex-col gap-4">
                      <div>
                        <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-green-700">
                          <span className="size-1.5 rounded-full bg-green-500" />
                          {resolvedPlan ? "Подписка активна" : "Подписка не назначена"}
                        </div>
                        <h3 className="font-display text-3xl font-bold text-slate-900">
                          {resolvedPlan?.name ?? "Подписка не назначена"}
                        </h3>
                        {resolvedPlan && resolvedPlan.monthlyPriceUsd !== null ? (
                          <div className="flex items-baseline gap-1 text-slate-500">
                            <span className="text-xl font-medium text-slate-900">
                              ${resolvedPlan.monthlyPriceUsd}
                            </span>
                            <span className="text-sm">/ месяц</span>
                          </div>
                        ) : (
                          <p className="text-sm text-slate-500">
                            Индивидуальные условия тарифа
                          </p>
                        )}
                      </div>
                      <p className="max-w-sm text-sm leading-relaxed text-slate-500">
                        {resolvedPlan
                          ? resolvedPlan.description ??
                            "Подписка дает включенный лимит кредитов на период, а при необходимости баланс можно пополнить отдельно."
                          : "Назначьте тариф, чтобы получить включенный лимит кредитов на период. Дополнительные кредиты можно докупать отдельно."}
                      </p>
                    </div>
                    <div className="flex min-w-[160px] flex-col gap-3">
                      <button
                        className="w-full rounded-lg bg-slate-300 px-4 py-2 text-sm font-medium text-white shadow-sm"
                        disabled
                        type="button"
                      >
                        Смена тарифа скоро
                      </button>
                      <button
                        className="w-full rounded-lg border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-medium text-slate-400"
                        disabled
                        type="button"
                      >
                        Отмена скоро
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col justify-between gap-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-medium text-slate-900">
                      <div className="rounded-md bg-slate-100 p-1.5 text-primary">
                        <span className="material-symbols-outlined text-[20px]">
                          monitoring
                        </span>
                      </div>
                      Использование
                    </div>
                    <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">
                      {now.toLocaleDateString("ru-RU", { month: "long" })}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-end justify-between">
                      <span className="font-display text-2xl font-bold text-slate-900">
                        {formatCredits(spentCredits)}
                      </span>
                      {includedCredits !== null && (
                        <span className="mb-1.5 text-xs font-medium text-slate-500">
                          из {formatCredits(includedCredits)}
                        </span>
                      )}
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${creditPercent}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {includedCredits !== null
                        ? `${Math.round(creditPercent)}% от включенного лимита за период.`
                        : "Включенный лимит для этого тарифа пока не указан."}
                    </p>
                    <p className="text-xs text-slate-500">
                      Использовано токенов: {formatNumber(usedTokens)}
                    </p>
                    <p className="text-xs text-slate-500">
                      Дополнительный баланс: {formatCredits(Number(user?.balance ?? 0))}
                    </p>
                  </div>
                  {isAdmin && (
                    <Link
                      className="group mt-auto flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80"
                      href="/admin"
                    >
                      Подробная статистика
                      <span className="material-symbols-outlined text-[16px] transition-transform group-hover:translate-x-0.5">
                        arrow_forward
                      </span>
                    </Link>
                  )}
                </div>
              </div>

              <div
                className={`grid grid-cols-1 gap-6 ${
                  isB2B ? "lg:grid-cols-2" : ""
                }`}
              >
                <div className="flex flex-col gap-4">
                  <h3 className="font-display text-lg font-bold text-slate-900">
                    Способ оплаты
                  </h3>
                  <div className="flex h-full flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/50 p-4">
                      <div className="flex items-center gap-4">
                        <div className="flex h-8 w-12 items-center justify-center rounded border border-slate-200 bg-white">
                          <span className="text-xs font-semibold text-slate-500">
                            YK
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <p className="text-sm font-medium text-slate-900">
                            YooKassa checkout
                          </p>
                          <p className="text-xs text-slate-500">
                            Используйте пополнение баланса и покупку подписки
                          </p>
                        </div>
                      </div>
                      <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                        YooKassa-ready
                      </span>
                    </div>
                    <div className="rounded-lg border border-dashed border-slate-300 p-4">
                      <TopUpForm />
                    </div>
                  </div>
                </div>

                {isB2B && (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-lg font-bold text-slate-900">
                        Реквизиты (B2B)
                      </h3>
                      <Link
                        className="text-sm font-medium text-primary hover:underline"
                        href="/org"
                      >
                        Управлять
                      </Link>
                    </div>
                    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Компания
                          </label>
                          <input
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                            type="text"
                            value={orgCompany}
                            readOnly
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            ИНН / Налоговый ID
                          </label>
                          <input
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                            type="text"
                            value={orgTaxId}
                            readOnly
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Юридический адрес
                        </label>
                        <input
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                          type="text"
                          value={orgAddress}
                          readOnly
                        />
                      </div>
                      {!org && (
                        <p className="text-xs text-slate-500">
                          Реквизиты доступны после создания организации.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-lg font-bold text-slate-900">
                    История платежей
                  </h3>
                  <button
                    className="flex items-center gap-1 text-sm text-slate-400"
                    disabled
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      filter_list
                    </span>
                    Фильтр скоро
                  </button>
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
                            Инвойс
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {transactions.length === 0 && (
                          <tr>
                            <td
                              className="px-6 py-6 text-center text-sm text-slate-500"
                              colSpan={5}
                            >
                              История платежей появится после первых операций.
                            </td>
                          </tr>
                        )}
                        {transactions.map((tx) => {
                          const amount = Number(tx.amount ?? 0);
                          const isRefill = tx.type === "REFILL";
                          return (
                            <tr key={tx.id} className="group transition-colors hover:bg-slate-50">
                              <td className="whitespace-nowrap px-6 py-4 text-slate-900">
                                {tx.createdAt.toLocaleDateString("ru-RU", {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                })}
                              </td>
                              <td className="whitespace-nowrap px-6 py-4 font-medium text-slate-900">
                                {tx.description}
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
                                  className="rounded p-1 text-slate-300"
                                  disabled
                                  type="button"
                                >
                                  <span className="material-symbols-outlined text-[20px]">
                                    download
                                  </span>
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
                      className="text-sm font-medium text-slate-400"
                      disabled
                      type="button"
                    >
                      Пагинация скоро
                    </button>
                  </div>
                </div>
              </div>
            </div>
      </AppShell>
  );
}
