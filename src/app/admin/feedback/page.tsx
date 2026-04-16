import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function categoryLabel(value: "GENERAL" | "IMPROVEMENT" | "BUG") {
  switch (value) {
    case "BUG":
      return "Баг";
    case "IMPROVEMENT":
      return "Улучшение";
    default:
      return "Общее";
  }
}

function statusLabel(value: "NEW" | "REVIEWED") {
  return value === "REVIEWED" ? "Просмотрено" : "Новый";
}

export default async function AdminFeedbackPage() {
  const feedbackItems = await prisma.feedback.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      user: {
        select: {
          email: true,
          telegramId: true,
        },
      },
    },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
        <h1 className="text-2xl font-semibold text-text-main font-display">
          Обратная связь
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Здесь собраны оценки пользователей, идеи, замечания и найденные баги.
        </p>
      </div>

      <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
        {feedbackItems.length === 0 ? (
          <p className="text-sm text-text-secondary">Отзывов пока нет.</p>
        ) : (
          <div className="space-y-4">
            {feedbackItems.map((item) => {
              const email = item.emailSnapshot ?? item.user?.email ?? "Не указан";
              const telegramId =
                item.telegramIdSnapshot ?? item.user?.telegramId ?? "Не указан";
              const displayName = item.displayNameSnapshot || "Пользователь";

              return (
                <article
                  key={item.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                          {categoryLabel(item.category)}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                          {statusLabel(item.status)}
                        </span>
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                          {"★".repeat(item.rating)}
                          {"☆".repeat(5 - item.rating)}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{displayName}</p>
                        <p className="text-xs text-slate-500">
                          {email} • Telegram: {telegramId}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500">{formatDate(item.createdAt)}</p>
                  </div>

                  <div className="mt-4 rounded-xl bg-white px-4 py-3 text-sm text-slate-800 whitespace-pre-wrap">
                    {item.message}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
