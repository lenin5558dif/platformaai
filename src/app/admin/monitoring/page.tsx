import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { requireAdminActor } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { getPlatformConfig, updatePlatformConfig } from "@/lib/platform-config";

export const dynamic = "force-dynamic";

type TimeWindow = "1h" | "24h" | "7d";

function resolveWindow(raw: string | undefined): TimeWindow {
  if (raw === "1h") return "1h";
  if (raw === "7d") return "7d";
  return "24h";
}

function windowRange(window: TimeWindow) {
  const now = Date.now();
  if (window === "1h") {
    return {
      start: new Date(now - 60 * 60 * 1000),
      bucketMs: 5 * 60 * 1000,
      points: 12,
    };
  }
  if (window === "7d") {
    return {
      start: new Date(now - 7 * 24 * 60 * 60 * 1000),
      bucketMs: 6 * 60 * 60 * 1000,
      points: 28,
    };
  }
  return {
    start: new Date(now - 24 * 60 * 60 * 1000),
    bucketMs: 60 * 60 * 1000,
    points: 24,
  };
}

type Bucket = {
  start: Date;
  requests: number;
  errors: number;
  durations: number[];
};

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function p95(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx];
}

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, entry) => sum + entry, 0) / values.length;
}

function formatMs(value: number) {
  if (!value || Number.isNaN(value)) return "0 ms";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

async function toggleModelStatus(modelId: string, disable: boolean) {
  "use server";
  const admin = await requireAdminActor();
  const config = await getPlatformConfig();
  const next = new Set(config.disabledModelIds);
  if (disable) {
    next.add(modelId);
  } else {
    next.delete(modelId);
  }

  await updatePlatformConfig({
    disabledModelIds: Array.from(next),
    updatedById: admin.id,
  });

  await logAudit({
    action: "PLATFORM_MODEL_TOGGLED",
    orgId: null,
    actorId: admin.id,
    targetType: "model",
    targetId: modelId,
    metadata: {
      disabled: disable,
      source: "admin-monitoring",
    },
  });

  revalidatePath("/admin/monitoring");
  revalidatePath("/admin/api-routing");
}

export default async function AdminMonitoringPage({
  searchParams,
}: {
  searchParams?: Promise<{ window?: string }>;
}) {
  await requireAdminActor();

  const params = searchParams ? await searchParams : undefined;
  const window = resolveWindow(params?.window);
  const range = windowRange(window);

  const [events, platformConfig] = await Promise.all([
    prisma.eventLog.findMany({
      where: {
        createdAt: { gte: range.start },
        type: { in: ["AI_REQUEST", "AI_ERROR"] },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        type: true,
        modelId: true,
        payload: true,
        createdAt: true,
      },
    }),
    getPlatformConfig(),
  ]);

  const nowMs = Date.now();
  const buckets: Bucket[] = Array.from({ length: range.points }, (_, index) => ({
    start: new Date(range.start.getTime() + index * range.bucketMs),
    requests: 0,
    errors: 0,
    durations: [],
  }));

  let latestRateRemaining: number | null = null;
  let latestRateLimit: number | null = null;
  const modelErrorMap = new Map<string, number>();

  for (const event of events) {
    const bucketIndex = Math.floor(
      (event.createdAt.getTime() - range.start.getTime()) / range.bucketMs
    );
    if (bucketIndex < 0 || bucketIndex >= buckets.length) continue;
    const bucket = buckets[bucketIndex];
    const payload =
      event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
        ? (event.payload as Record<string, unknown>)
        : null;

    if (event.type === "AI_REQUEST") {
      bucket.requests += 1;
      const durationMs = payload ? toNumber(payload.durationMs) : null;
      if (durationMs !== null) {
        bucket.durations.push(durationMs);
      }
      const remaining = payload ? toNumber(payload.rateLimitRemaining) : null;
      const limit = payload ? toNumber(payload.rateLimitLimit) : null;
      if (remaining !== null) latestRateRemaining = remaining;
      if (limit !== null) latestRateLimit = limit;
    } else {
      bucket.errors += 1;
      const key = event.modelId ?? "unknown";
      modelErrorMap.set(key, (modelErrorMap.get(key) ?? 0) + 1);
      const durationMs = payload ? toNumber(payload.durationMs) : null;
      if (durationMs !== null) {
        bucket.durations.push(durationMs);
      }
    }
  }

  const maxVolume = buckets.reduce(
    (max, bucket) => Math.max(max, bucket.requests + bucket.errors),
    1
  );
  const latencyValues = buckets.flatMap((bucket) => bucket.durations);
  const overallP95 = p95(latencyValues);
  const overallAvg = avg(latencyValues);
  const totalRequests = buckets.reduce((sum, bucket) => sum + bucket.requests, 0);
  const totalErrors = buckets.reduce((sum, bucket) => sum + bucket.errors, 0);
  const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;

  const tenMinutesAgo = nowMs - 10 * 60 * 1000;
  const recentEvents = events.filter((event) => event.createdAt.getTime() >= tenMinutesAgo);
  const recentRequests = recentEvents.filter((event) => event.type === "AI_REQUEST").length;
  const recentErrors = recentEvents.filter((event) => event.type === "AI_ERROR").length;
  const recentErrorRate = recentRequests > 0 ? recentErrors / recentRequests : 0;
  const incident =
    recentRequests >= 10 && recentErrorRate >= 0.15
      ? { level: "critical", message: "За последние 10 минут выросла частота ошибок AI." }
      : recentRequests >= 5 && recentErrorRate >= 0.08
      ? { level: "warning", message: "Наблюдается рост ошибок AI в коротком окне." }
      : null;

  const topErrorModels = Array.from(modelErrorMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([modelId, errors]) => ({ modelId, errors }));

  const providerLimitStatus =
    latestRateRemaining !== null && latestRateLimit && latestRateLimit > 0
      ? {
          remaining: latestRateRemaining,
          limit: latestRateLimit,
          ratio: latestRateRemaining / latestRateLimit,
        }
      : null;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
        <h1 className="text-2xl font-semibold text-text-main font-display">
          Мониторинг системы
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Latency API, error rates и статус лимитов провайдера. При инцидентах
          можно отключать проблемные модели.
        </p>
      </div>

      {incident && (
        <div
          className={`rounded-xl p-4 text-sm ${
            incident.level === "critical"
              ? "border border-rose-300 bg-rose-50 text-rose-800"
              : "border border-amber-300 bg-amber-50 text-amber-800"
          }`}
        >
          {incident.message}
        </div>
      )}

      <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
        <div className="flex flex-wrap gap-2">
          {(["1h", "24h", "7d"] as const).map((item) => (
            <a
              key={item}
              href={`/admin/monitoring?window=${item}`}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                item === window
                  ? "bg-primary text-white"
                  : "border border-gray-200 text-text-main hover:bg-white"
              }`}
            >
              {item}
            </a>
          ))}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
            <p className="text-xs text-text-secondary">Latency p95</p>
            <p className="text-xl font-semibold text-text-main">{formatMs(overallP95)}</p>
            <p className="mt-1 text-xs text-text-secondary">
              Средняя: {formatMs(overallAvg)}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
            <p className="text-xs text-text-secondary">Error rate</p>
            <p className="text-xl font-semibold text-text-main">
              {(errorRate * 100).toFixed(2)}%
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              Ошибки: {totalErrors} / Запросы: {totalRequests}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
            <p className="text-xs text-text-secondary">Лимит провайдера</p>
            {providerLimitStatus ? (
              <>
                <p className="text-xl font-semibold text-text-main">
                  {Math.round(providerLimitStatus.remaining)} /{" "}
                  {Math.round(providerLimitStatus.limit)}
                </p>
                <p
                  className={`mt-1 text-xs ${
                    providerLimitStatus.ratio < 0.1
                      ? "text-rose-700"
                      : providerLimitStatus.ratio < 0.25
                      ? "text-amber-700"
                      : "text-emerald-700"
                  }`}
                >
                  {providerLimitStatus.ratio < 0.1
                    ? "Критически близко к лимиту"
                    : providerLimitStatus.ratio < 0.25
                    ? "Низкий остаток лимита"
                    : "Лимит в норме"}
                </p>
              </>
            ) : (
              <p className="text-sm text-text-secondary mt-1">
                Данные о лимитах пока не поступали.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
        <h2 className="text-lg font-semibold text-text-main font-display">
          График нагрузки и ошибок
        </h2>
        <div className="mt-4 space-y-3">
          {buckets.map((bucket) => {
            const total = bucket.requests + bucket.errors;
            const totalWidth = Math.max(2, Math.round((total / maxVolume) * 100));
            const errorWidth = total > 0 ? Math.round((bucket.errors / total) * totalWidth) : 0;
            const label = new Intl.DateTimeFormat("ru-RU", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            }).format(bucket.start);
            return (
              <div key={bucket.start.toISOString()}>
                <div className="mb-1 flex items-center justify-between text-xs text-text-secondary">
                  <span>{label}</span>
                  <span>
                    req {bucket.requests} • err {bucket.errors}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-gray-200/70 overflow-hidden">
                  <div className="h-2 rounded-full bg-emerald-500 relative" style={{ width: `${totalWidth}%` }}>
                    {errorWidth > 0 && (
                      <div
                        className="absolute right-0 top-0 h-2 bg-rose-500"
                        style={{ width: `${errorWidth}%` }}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
        <h2 className="text-lg font-semibold text-text-main font-display">
          Отключение проблемных моделей
        </h2>
        <p className="mt-1 text-xs text-text-secondary">
          Глобальный denylist применяется в WEB, image и Telegram каналах.
        </p>
        <div className="mt-4 space-y-2">
          {topErrorModels.length === 0 ? (
            <p className="text-sm text-text-secondary">Пока нет данных об ошибках моделей.</p>
          ) : (
            topErrorModels.map((entry) => {
              const disabled = platformConfig.disabledModelIds.includes(entry.modelId);
              return (
                <div
                  key={entry.modelId}
                  className="rounded-lg border border-gray-200 bg-white/70 px-3 py-2 flex items-center justify-between gap-3"
                >
                  <div>
                    <p className="text-sm font-medium text-text-main">{entry.modelId}</p>
                    <p className="text-xs text-text-secondary">Ошибок: {entry.errors}</p>
                  </div>
                  <form action={toggleModelStatus.bind(null, entry.modelId, !disabled)}>
                    <button
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                        disabled
                          ? "border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                          : "border border-rose-300 text-rose-700 hover:bg-rose-50"
                      }`}
                    >
                      {disabled ? "Включить модель" : "Отключить модель"}
                    </button>
                  </form>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
