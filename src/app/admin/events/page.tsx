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

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const limit = clampNumber(Number(params?.limit ?? 100), 10, 500);
  const selectedType = EVENT_TYPES.includes(
    params?.type as (typeof EVENT_TYPES)[number]
  )
    ? (params?.type as (typeof EVENT_TYPES)[number])
    : "";
  const selectedModel = (params?.model ?? "").trim();

  const events = await prisma.eventLog.findMany({
    where: {
      type: selectedType
        ? (selectedType as (typeof EVENT_TYPES)[number])
        : undefined,
      modelId: selectedModel ? selectedModel : undefined,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
        <h1 className="text-2xl font-semibold text-text-main font-display">
          События платформы
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Глобальные логи запросов и ошибок по AI, биллингу и аутентификации.
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
            className="mt-2 w-52 rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
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
                {event.userId && (
                  <span className="rounded-full bg-white px-2 py-0.5 border border-gray-200">
                    user: {event.userId}
                  </span>
                )}
                {event.modelId && (
                  <span className="rounded-full bg-white px-2 py-0.5 border border-gray-200">
                    {event.modelId}
                  </span>
                )}
              </div>
              {event.message && (
                <p className="mt-2 text-sm text-text-main">{event.message}</p>
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
  );
}
