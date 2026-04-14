import AppShell from "@/components/layout/AppShell";
import { requirePageSession } from "@/lib/auth";
import { fetchModels } from "@/lib/models";

export default async function ModelsPage() {
  const session = await requirePageSession();
  let models: Awaited<ReturnType<typeof fetchModels>> = [];
  let error: string | null = null;

  try {
    models = await fetchModels();
  } catch (err) {
    error = err instanceof Error ? err.message : "Не удалось загрузить модели.";
  }

  return (
    <AppShell
      title="Модели"
      subtitle="Список моделей OpenRouter и базовые цены."
      user={{
        email: session.user.email,
        role: session.user.role,
      }}
    >
      <div className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white/92 p-6 shadow-glass-sm">
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        ) : models.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Список моделей пока пуст. Проверьте подключение OpenRouter и повторите позже.
          </div>
        ) : (
          <div className="space-y-2.5">
            {models.map((model) => (
              <div
                key={model.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-[0_2px_10px_rgba(15,23,42,0.04)] transition-colors hover:bg-white"
              >
                <div>
                  <p className="text-sm font-medium text-text-main">
                    {model.name}
                  </p>
                  <p className="text-xs text-slate-500">{model.id}</p>
                </div>
                <div className="text-xs text-slate-600">
                  Prompt: {model.pricing?.prompt ?? "—"} • Completion:{" "}
                  {model.pricing?.completion ?? "—"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
