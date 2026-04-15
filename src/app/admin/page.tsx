import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type ActivityRow = {
  day: Date;
  activeUsers: number;
  requests: number;
  tokens: number;
};

type TopModelRow = {
  modelId: string;
  requests: number;
  tokens: number;
  credits: string;
};

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

export default async function AdminDashboardPage() {
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);

  const [usersTotal, usersActive, tokensTotal, last24h, last7d] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.message.aggregate({
      where: { role: "ASSISTANT" },
      _sum: { tokenCount: true, cost: true },
      _count: { _all: true },
    }),
    prisma.message.aggregate({
      where: { role: "ASSISTANT", createdAt: { gte: dayAgo } },
      _sum: { tokenCount: true, cost: true },
      _count: { _all: true },
    }),
    prisma.message.aggregate({
      where: { role: "ASSISTANT", createdAt: { gte: weekAgo } },
      _sum: { tokenCount: true, cost: true },
      _count: { _all: true },
    }),
  ]);

  const activityRows = await prisma.$queryRaw<ActivityRow[]>`
    SELECT
      DATE_TRUNC('day', "createdAt") AS "day",
      COUNT(DISTINCT "userId")::int AS "activeUsers",
      COUNT(*)::int AS "requests",
      COALESCE(SUM("tokenCount"), 0)::int AS "tokens"
    FROM "Message"
    WHERE "role" = 'ASSISTANT'
      AND "createdAt" >= ${twoWeeksAgo}
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  const topModels = await prisma.$queryRaw<TopModelRow[]>`
    SELECT
      COALESCE("modelId", 'unknown') AS "modelId",
      COUNT(*)::int AS "requests",
      COALESCE(SUM("tokenCount"), 0)::int AS "tokens",
      COALESCE(SUM("cost"), 0)::text AS "credits"
    FROM "Message"
    WHERE "role" = 'ASSISTANT'
    GROUP BY 1
    ORDER BY SUM("tokenCount") DESC
    LIMIT 10
  `;

  const peakActiveUsers =
    activityRows.reduce((max, row) => Math.max(max, row.activeUsers), 0) || 1;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
        <h1 className="text-2xl font-semibold text-text-main font-display">
          Главный экран админ-панели
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Сводка по активности пользователей, фактическому токен-потреблению и
          использованию моделей.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-5">
          <p className="text-xs text-text-secondary">Пользователи</p>
          <p className="text-2xl font-semibold text-text-main">
            {formatNumber(usersTotal)}
          </p>
          <p className="mt-1 text-xs text-text-secondary">
            Активных аккаунтов: {formatNumber(usersActive)}
          </p>
        </div>
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-5">
          <p className="text-xs text-text-secondary">Токены всего (факт)</p>
          <p className="text-2xl font-semibold text-text-main">
            {formatNumber(tokensTotal._sum?.tokenCount ?? 0)}
          </p>
          <p className="mt-1 text-xs text-text-secondary">
            Ответов ассистента: {formatNumber(tokensTotal._count?._all ?? 0)}
          </p>
        </div>
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-5">
          <p className="text-xs text-text-secondary">За 24 часа</p>
          <p className="text-2xl font-semibold text-text-main">
            {formatNumber(last24h._sum?.tokenCount ?? 0)}
          </p>
          <p className="mt-1 text-xs text-text-secondary">
            Кредиты: {formatCredits(last24h._sum?.cost?.toString())}
          </p>
        </div>
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-5">
          <p className="text-xs text-text-secondary">За 7 дней</p>
          <p className="text-2xl font-semibold text-text-main">
            {formatNumber(last7d._sum?.tokenCount ?? 0)}
          </p>
          <p className="mt-1 text-xs text-text-secondary">
            Кредиты: {formatCredits(last7d._sum?.cost?.toString())}
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
          <h2 className="text-lg font-semibold text-text-main font-display">
            Активность пользователей (14 дней)
          </h2>
          <div className="mt-4 space-y-3">
            {activityRows.length === 0 && (
              <p className="text-sm text-text-secondary">Данных пока нет.</p>
            )}
            {activityRows.map((row) => {
              const widthPercent = Math.max(
                4,
                Math.round((row.activeUsers / peakActiveUsers) * 100)
              );
              const dayLabel = new Intl.DateTimeFormat("ru-RU", {
                day: "2-digit",
                month: "short",
              }).format(new Date(row.day));
              return (
                <div key={`${row.day.toString()}-${row.activeUsers}`}>
                  <div className="mb-1 flex items-center justify-between text-xs text-text-secondary">
                    <span>{dayLabel}</span>
                    <span>
                      {formatNumber(row.activeUsers)} активных •{" "}
                      {formatNumber(row.requests)} запросов
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-200/70">
                    <div
                      className="h-2 rounded-full bg-primary"
                      style={{ width: `${widthPercent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
          <h2 className="text-lg font-semibold text-text-main font-display">
            Топ-моделей по использованию
          </h2>
          {topModels.length === 0 ? (
            <p className="mt-4 text-sm text-text-secondary">Данных пока нет.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-text-secondary">
                    <th className="pb-3">Модель</th>
                    <th className="pb-3">Запросы</th>
                    <th className="pb-3">Токены</th>
                    <th className="pb-3">Кредиты</th>
                  </tr>
                </thead>
                <tbody className="text-text-main">
                  {topModels.map((row) => (
                    <tr key={row.modelId} className="border-t border-white/40">
                      <td className="py-3 pr-4">{row.modelId}</td>
                      <td className="py-3 pr-4">{formatNumber(row.requests)}</td>
                      <td className="py-3 pr-4">{formatNumber(row.tokens)}</td>
                      <td className="py-3">{formatCredits(row.credits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
