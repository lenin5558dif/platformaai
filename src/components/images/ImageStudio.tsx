"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

type ImageModel = {
  id: string;
  name?: string;
  pricing?: Record<string, string | undefined>;
};

type ImageGeneration = {
  id: string;
  prompt: string;
  modelId: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  cost: string;
  fileUrl: string | null;
  revisedPrompt?: string | null;
  createdAt: string;
};

const aspectRatios = ["1:1", "16:9", "9:16", "4:3", "3:4"];
const imageSizes = ["1K", "2K"];

function isFreeModel(model: ImageModel) {
  const values = Object.values(model.pricing ?? {})
    .map((value) => (typeof value === "string" ? Number(value) : Number.NaN))
    .filter((value) => Number.isFinite(value));
  return (
    model.id.toLowerCase().endsWith(":free") ||
    (values.some((value) => value === 0) && values.every((value) => value === 0))
  );
}

function modelLabel(model: ImageModel) {
  return model.name ? `${model.name} · ${model.id}` : model.id;
}

export default function ImageStudio() {
  const [models, setModels] = useState<ImageModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [imageSize, setImageSize] = useState("1K");
  const [result, setResult] = useState<ImageGeneration | null>(null);
  const [modelsStatus, setModelsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [submitStatus, setSubmitStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadModels() {
      setModelsStatus("loading");
      try {
        const response = await fetch("/api/images/models", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error ?? "Не удалось загрузить модели");
        }
        const nextModels = (payload?.data?.data ?? []) as ImageModel[];
        if (cancelled) return;
        setModels(nextModels);
        setSelectedModel((current) => current || nextModels[0]?.id || "");
        setModelsStatus("ready");
      } catch (loadError) {
        if (cancelled) return;
        setModelsStatus("error");
        setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить модели");
      }
    }

    void loadModels();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || !selectedModel || submitStatus === "loading") return;

    setSubmitStatus("loading");
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          modelId: selectedModel,
          aspectRatio,
          imageSize,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "Не удалось сгенерировать изображение");
      }
      setResult(payload.data as ImageGeneration);
      setSubmitStatus("success");
    } catch (submitError) {
      setSubmitStatus("error");
      setError(submitError instanceof Error ? submitError.message : "Не удалось сгенерировать изображение");
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]">
      <form
        className="rounded-3xl border border-white/70 bg-white/75 p-5 shadow-[0_18px_60px_rgba(69,49,40,0.08)] backdrop-blur sm:p-6"
        onSubmit={handleSubmit}
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
            Генерация
          </p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-slate-950">
            Опишите изображение
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Чем точнее стиль, объект, фон и настроение, тем стабильнее результат.
          </p>
        </div>

        <label className="mt-5 block">
          <span className="text-sm font-semibold text-slate-800">Промпт</span>
          <textarea
            className="mt-2 min-h-40 w-full resize-y rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            placeholder="Например: уютная кофейня на Марсе, утренний свет, детальная иллюстрация..."
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            maxLength={4000}
          />
        </label>

        <label className="mt-4 block">
          <span className="text-sm font-semibold text-slate-800">Модель</span>
          <select
            className="mt-2 h-12 w-full cursor-pointer rounded-2xl border border-slate-200 bg-white/90 px-4 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
            value={selectedModel}
            onChange={(event) => setSelectedModel(event.target.value)}
            disabled={modelsStatus !== "ready" || models.length === 0}
          >
            {modelsStatus === "loading" && <option>Загружаю модели...</option>}
            {modelsStatus === "error" && <option>Модели недоступны</option>}
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {modelLabel(model)}{isFreeModel(model) ? " · free" : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label>
            <span className="text-sm font-semibold text-slate-800">Пропорция</span>
            <select
              className="mt-2 h-12 w-full cursor-pointer rounded-2xl border border-slate-200 bg-white/90 px-4 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
              value={aspectRatio}
              onChange={(event) => setAspectRatio(event.target.value)}
            >
              {aspectRatios.map((ratio) => (
                <option key={ratio} value={ratio}>{ratio}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-sm font-semibold text-slate-800">Размер</span>
            <select
              className="mt-2 h-12 w-full cursor-pointer rounded-2xl border border-slate-200 bg-white/90 px-4 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
              value={imageSize}
              onChange={(event) => setImageSize(event.target.value)}
            >
              {imageSizes.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          className="mt-5 inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-sm font-bold text-white shadow-[0_18px_30px_rgba(212,122,106,0.24)] transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!prompt.trim() || !selectedModel || submitStatus === "loading"}
        >
          {submitStatus === "loading" ? "Генерирую..." : "Сгенерировать"}
          <span className="material-symbols-outlined text-[19px]">auto_awesome</span>
        </button>
      </form>

      <section className="rounded-3xl border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.78),rgba(249,239,232,0.72))] p-5 shadow-[0_18px_60px_rgba(69,49,40,0.08)] sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
              Результат
            </p>
            <h2 className="mt-2 font-display text-2xl font-semibold text-slate-950">
              Последняя генерация
            </h2>
          </div>
          {submitStatus === "success" && (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              Готово
            </span>
          )}
        </div>

        <div className="mt-5 flex min-h-[420px] items-center justify-center overflow-hidden rounded-3xl border border-white/80 bg-white/60">
          {submitStatus === "loading" ? (
            <div className="text-center text-sm text-slate-500">
              <div className="mx-auto mb-4 size-12 animate-pulse rounded-full bg-primary/25" />
              Генерация может занять до минуты.
            </div>
          ) : result?.fileUrl ? (
            <img
              src={result.fileUrl}
              alt={result.prompt}
              className="h-full max-h-[520px] w-full object-contain"
            />
          ) : (
            <div className="max-w-sm px-6 text-center text-sm leading-6 text-slate-500">
              Здесь появится изображение после генерации.
            </div>
          )}
        </div>

        {result && (
          <div className="mt-4 rounded-2xl border border-white/80 bg-white/70 p-4 text-sm text-slate-600">
            <p className="font-semibold text-slate-900">{result.modelId}</p>
            <p className="mt-1 line-clamp-3">{result.prompt}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {result.fileUrl && (
                <a
                  className="inline-flex min-h-10 cursor-pointer items-center rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:border-primary/40 hover:text-primary"
                  href={result.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть файл
                </a>
              )}
              <span className="inline-flex min-h-10 items-center rounded-full bg-slate-100 px-4 text-xs font-semibold text-slate-600">
                Стоимость: {result.cost}
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
