import Link from "next/link";
import { auth } from "@/lib/auth";
import { isGlobalAdminSession } from "@/lib/admin-access";
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

  if (!isGlobalAdminSession(session)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6 text-center">
          <h1 className="text-2xl font-semibold text-text-main mb-2 font-display">
            Недостаточно прав
          </h1>
          <p className="text-sm text-text-secondary">
            Админ‑панель доступна только платформенным администраторам.
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
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <h1 className="text-2xl font-semibold text-text-main mb-2 font-display">
                Админ‑панель
              </h1>
              <p className="text-sm text-text-secondary">
                Обзор потребления токенов и используемых моделей. Отсюда удобно перейти к org,
                аудиту и событиям, если нужно разбирать расход или доступы.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/org"
                className="rounded-full border border-gray-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-white"
              >
                Org
              </Link>
              <Link
                href="/audit"
                className="rounded-full border border-gray-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-white"
              >
                Audit
              </Link>
              <Link
                href="/events"
                className="rounded-full border border-gray-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-white"
              >
                Events
              </Link>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {[
              {
                title: "Проверить org",
                text: "Если расход выглядит неожиданно, откройте управление организацией и проверьте роли.",
              },
              {
                title: "Сверить аудит",
                text: "Аудит помогает быстро понять, кто менял доступы и почему вырос расход.",
              },
              {
                title: "Сопоставить модели",
                text: "Смотрите на модели с высоким токен-объёмом, чтобы ловить перекосы в usage.",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-gray-200 bg-white/70 p-4">
                <p className="text-sm font-semibold text-text-main">{item.title}</p>
                <p className="mt-1 text-xs text-text-secondary">{item.text}</p>
              </div>
            ))}
          </div>
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
            <div className="rounded-xl border border-dashed border-gray-300 bg-white/60 px-4 py-4">
              <p className="text-sm font-medium text-text-main">Пока нет данных по использованию</p>
              <p className="mt-1 text-xs text-text-secondary">
                Когда появятся сообщения, здесь начнут расти счётчики по моделям, токенам и
                кредитам. Если цифры пустые слишком долго, проверьте, что пользователи реально
                отправляют запросы в чат.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
