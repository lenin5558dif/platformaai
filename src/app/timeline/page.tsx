import { requirePageSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const SOURCE_OPTIONS = ["ALL", "WEB", "TELEGRAM"] as const;

type SearchParams = {
  source?: string;
  limit?: string;
};

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function truncate(text: string, max = 200) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

export default async function TimelinePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const session = await requirePageSession();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, orgId: true },
  });

  const limit = clampNumber(Number(resolvedParams?.limit ?? 100), 20, 300);
  const source = SOURCE_OPTIONS.includes(
    resolvedParams?.source as (typeof SOURCE_OPTIONS)[number]
  )
    ? (resolvedParams?.source as (typeof SOURCE_OPTIONS)[number])
    : "ALL";

  const sourceFilter = source === "ALL" ? undefined : source;

  const messages = await prisma.message.findMany({
    where:
      user?.role === "ADMIN" && user.orgId
        ? {
            user: { orgId: user.orgId },
            chat: sourceFilter ? { source: sourceFilter } : undefined,
          }
        : {
            userId: session.user.id,
            chat: sourceFilter ? { source: sourceFilter } : undefined,
          },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      chat: { select: { title: true, modelId: true, source: true } },
      user: { select: { email: true, telegramId: true } },
    },
  });

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
          <h1 className="text-2xl font-semibold text-text-main mb-2 font-display">
            Лента сообщений
          </h1>
          <p className="text-sm text-text-secondary">
            Общая история Web и Telegram сообщений.
          </p>
        </div>

        <form className="flex flex-wrap items-end gap-3 rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-4">
          <div>
            <label className="block text-xs text-text-secondary">Источник</label>
            <select
              name="source"
              defaultValue={source}
              className="mt-2 rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
            >
              {SOURCE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-secondary">Лимит</label>
            <input
              name="limit"
              type="number"
              defaultValue={limit}
              className="mt-2 w-24 rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
            />
          </div>
          <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover">
            Применить
          </button>
        </form>

        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
          <h2 className="text-lg font-semibold text-text-main mb-4 font-display">
            Последние сообщения
          </h2>
          <div className="space-y-3">
            {messages.length === 0 && (
              <p className="text-xs text-text-secondary">Сообщений пока нет.</p>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className="rounded-xl border border-gray-200 bg-white/70 px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px]">
                    {message.chat?.source ?? "WEB"}
                  </span>
                  <span>{message.createdAt.toLocaleString("ru-RU")}</span>
                  <span className="rounded-full bg-white px-2 py-0.5 border border-gray-200">
                    {message.role}
                  </span>
                  <span className="rounded-full bg-white px-2 py-0.5 border border-gray-200">
                    {message.chat?.modelId ?? ""}
                  </span>
                  {message.user?.email && (
                    <span className="rounded-full bg-white px-2 py-0.5 border border-gray-200">
                      {message.user.email}
                    </span>
                  )}
                  {!message.user?.email && message.user?.telegramId && (
                    <span className="rounded-full bg-white px-2 py-0.5 border border-gray-200">
                      {message.user.telegramId}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm font-medium text-text-main">
                  {message.chat?.title ?? "Чат"}
                </p>
                <p className="mt-2 text-xs text-text-secondary whitespace-pre-wrap">
                  {truncate(message.content)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
