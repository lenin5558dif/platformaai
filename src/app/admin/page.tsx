import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function formatNumber(value: number | null | undefined) {
  if (!value || Number.isNaN(value)) return "0";
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatCredits(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "0";
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) return "0";
  return num.toFixed(2);
}

export default async function AdminPage() {
  const session = await auth();

  if (!session?.user?.id) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6 text-center">
          <h1 className="text-2xl font-semibold text-text-main mb-2 font-display">
            Доступ запрещен
          </h1>
          <p className="text-sm text-text-secondary">Требуется авторизация.</p>
        </div>
      </div>
    );
  }

  if (session.user.role !== "ADMIN") {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6 text-center">
          <h1 className="text-2xl font-semibold text-text-main mb-2 font-display">
            Недостаточно прав
          </h1>
          <p className="text-sm text-text-secondary">
            Админ‑панель доступна только администраторам.
          </p>
        </div>
      </div>
    );
  }

  const totals = await prisma.message.aggregate({
    _sum: { tokenCount: true, cost: true },
    _count: { _all: true },
  });

  type ModelUsageRow = {
    modelId: string;
    messageCount: number;
    tokenCount: number;
    cost: string;
  };

  let byModel: ModelUsageRow[] = [];
  try {
    byModel = await prisma.$queryRaw<ModelUsageRow[]>`
      SELECT
        "modelId" AS "modelId",
        COUNT(*)::int AS "messageCount",
        COALESCE(SUM("tokenCount"), 0)::int AS "tokenCount",
        COALESCE(SUM("cost"), 0)::text AS "cost"
      FROM "Message"
      WHERE "modelId" IS NOT NULL
      GROUP BY "modelId"
      ORDER BY SUM("tokenCount") DESC
      LIMIT 20
    `;
  } catch {
    byModel = await prisma.$queryRaw<ModelUsageRow[]>`
      SELECT
        c."modelId" AS "modelId",
        COUNT(*)::int AS "messageCount",
        COALESCE(SUM(m."tokenCount"), 0)::int AS "tokenCount",
        COALESCE(SUM(m."cost"), 0)::text AS "cost"
      FROM "Message" m
      JOIN "Chat" c ON c.id = m."chatId"
      WHERE c."modelId" IS NOT NULL
      GROUP BY c."modelId"
      ORDER BY SUM(m."tokenCount") DESC
      LIMIT 20
    `;
  }

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
          <h1 className="text-2xl font-semibold text-text-main mb-2 font-display">
            Админ‑панель
          </h1>
          <p className="text-sm text-text-secondary">
            Обзор потребления токенов и используемых моделей.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-5">
            <p className="text-xs text-text-secondary">Всего сообщений</p>
            <p className="text-2xl font-semibold text-text-main">
              {formatNumber(totals._count?._all ?? 0)}
            </p>
          </div>
          <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-5">
            <p className="text-xs text-text-secondary">Всего токенов</p>
            <p className="text-2xl font-semibold text-text-main">
              {formatNumber(totals._sum?.tokenCount ?? 0)}
            </p>
          </div>
          <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-5">
            <p className="text-xs text-text-secondary">Списано кредитов</p>
            <p className="text-2xl font-semibold text-text-main">
              {formatCredits(totals._sum?.cost?.toString())}
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
          <h2 className="text-lg font-semibold text-text-main mb-4 font-display">
            Модели по потреблению
          </h2>
          {byModel.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-text-secondary">
                    <th className="pb-3">Модель</th>
                    <th className="pb-3">Сообщения</th>
                    <th className="pb-3">Токены</th>
                    <th className="pb-3">Кредиты</th>
                  </tr>
                </thead>
                <tbody className="text-text-main">
                  {byModel.map((row) => (
                    <tr key={row.modelId} className="border-t border-white/40">
                      <td className="py-3 pr-4">{row.modelId}</td>
                      <td className="py-3 pr-4">
                        {formatNumber(row.messageCount)}
                      </td>
                      <td className="py-3 pr-4">
                        {formatNumber(row.tokenCount)}
                      </td>
                      <td className="py-3">
                        {formatCredits(row.cost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-text-secondary">
              Пока нет данных по использованию.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
