import AppShell from "@/components/layout/AppShell";
import { fetchModels } from "@/lib/models";

export default async function ModelsPage() {
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
    >
      <div className="mx-auto max-w-4xl rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        ) : (
          <div className="space-y-2">
            {models.map((model) => (
              <div
                key={model.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white/70 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-text-main">
                    {model.name}
                  </p>
                  <p className="text-xs text-text-secondary">{model.id}</p>
                </div>
                <div className="text-xs text-text-secondary">
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
