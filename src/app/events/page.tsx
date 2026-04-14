import { requirePageSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const EVENT_TYPES = [
  "AI_REQUEST",
  "AI_ERROR",
  "BILLING_ERROR",
  "STT_ERROR",
  "AUTH_ERROR",
] as const;

type SearchParams = {
  type?: string;
  model?: string;
  limit?: string;
};

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatPayload(payload: unknown) {
  if (!payload) return "";
  try {
    const text = JSON.stringify(payload);
    return text.length > 240 ? `${text.slice(0, 240)}...` : text;
  } catch {
    return "";
  }
}

export default async function EventsPage({
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

  const limit = clampNumber(Number(resolvedParams?.limit ?? 50), 10, 200);
  const selectedType = EVENT_TYPES.includes(
    resolvedParams?.type as (typeof EVENT_TYPES)[number]
  )
    ? (resolvedParams?.type as (typeof EVENT_TYPES)[number])
    : "";
  const selectedModel = (resolvedParams?.model ?? "").trim();

  let userMap = new Map<string, { label: string }>();
  let userIds: string[] | null = null;

  if (user?.role === "ADMIN" && user.orgId) {
    const members = await prisma.user.findMany({
      where: { orgId: user.orgId },
      select: { id: true, email: true, telegramId: true },
    });
    userIds = members.map((member) => member.id);
    userMap = new Map(
      members.map((member) => [
        member.id,
        { label: member.email ?? member.telegramId ?? member.id },
      ])
    );
  }

  const events = await prisma.eventLog.findMany({
    where: {
      userId: userIds ? { in: userIds } : session.user.id,
      type: selectedType
        ? (selectedType as (typeof EVENT_TYPES)[number])
        : undefined,
      modelId: selectedModel ? selectedModel : undefined,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const exportParams = new URLSearchParams();
  if (selectedType) exportParams.set("type", selectedType);
  if (selectedModel) exportParams.set("model", selectedModel);
  exportParams.set("limit", String(limit));

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
          <h1 className="text-2xl font-semibold text-text-main mb-2 font-display">
            События
          </h1>
          <p className="text-sm text-text-secondary">
            Логи запросов и ошибок по чатам, биллингу и STT.
          </p>
        </div>

        <form className="flex flex-wrap items-end gap-3 rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-4">
          <div>
            <label className="block text-xs text-text-secondary">Тип</label>
            <select
              name="type"
              defaultValue={selectedType}
              className="mt-2 rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
            >
              <option value="">Все</option>
              {EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-secondary">Модель</label>
            <input
              name="model"
              defaultValue={selectedModel}
              placeholder="openai/gpt-4o"
              className="mt-2 w-44 rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
            />
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
          <a
            className="ml-auto rounded-lg border border-gray-200 bg-white/70 px-4 py-2 text-sm font-semibold text-text-main hover:bg-white"
            href={`/api/events/export?${exportParams.toString()}`}
          >
            Экспорт CSV
          </a>
        </form>

        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
          <h2 className="text-lg font-semibold text-text-main mb-4 font-display">
            Последние события
          </h2>
          <div className="space-y-3">
            {events.length === 0 && (
              <p className="text-xs text-text-secondary">Событий пока нет.</p>
            )}
            {events.map((event) => (
              <div
                key={event.id}
                className="rounded-xl border border-gray-200 bg-white/70 px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px]">
                    {event.type}
                  </span>
                  <span>{event.createdAt.toLocaleString("ru-RU")}</span>
                  {event.userId && userMap.size > 0 && (
                    <span className="rounded-full bg-white px-2 py-0.5 border border-gray-200">
                      {userMap.get(event.userId)?.label ?? event.userId}
                    </span>
                  )}
                  {event.chatId && (
                    <span className="rounded-full bg-white px-2 py-0.5 border border-gray-200">
                      chat: {event.chatId}
                    </span>
                  )}
                  {event.modelId && (
                    <span className="rounded-full bg-white px-2 py-0.5 border border-gray-200">
                      {event.modelId}
                    </span>
                  )}
                </div>
                {event.message && (
                  <p className="mt-2 text-sm text-text-main">
                    {event.message}
                  </p>
                )}
                {event.payload && (
                  <p className="mt-2 text-xs text-text-secondary break-all">
                    {formatPayload(event.payload)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
