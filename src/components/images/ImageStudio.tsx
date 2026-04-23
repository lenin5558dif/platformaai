"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Image from "next/image";

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

function getModelLabel(model: ImageModel) {
  return model.name ? model.name : model.id;
}

function getModelsFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as { data?: unknown };
  if (Array.isArray(record.data)) return record.data as ImageModel[];
  if (
    record.data &&
    typeof record.data === "object" &&
    Array.isArray((record.data as { data?: unknown }).data)
  ) {
    return (record.data as { data: ImageModel[] }).data;
  }
  return [];
}

export default function ImageStudio() {
  const [models, setModels] = useState<ImageModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [imageSize, setImageSize] = useState("1K");
  const [result, setResult] = useState<ImageGeneration | null>(null);
  const [gallery, setGallery] = useState<ImageGeneration[]>([]);
  const [modelsStatus, setModelsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [galleryStatus, setGalleryStatus] = useState<"loading" | "ready" | "error">("loading");
  const [submitStatus, setSubmitStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [modelsError, setModelsError] = useState("");
  const [submitError, setSubmitError] = useState("");

  async function loadModels() {
    setModelsStatus("loading");
    setModelsError("");

    try {
      const response = await fetch("/api/images/models", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "Не удалось загрузить модели");
      }

      const nextModels = getModelsFromPayload(payload);
      setModels(nextModels);
      setSelectedModel((current) => {
        if (current && nextModels.some((model) => model.id === current)) {
          return current;
        }
        return nextModels[0]?.id ?? "";
      });
      setModelsStatus("ready");

      if (nextModels.length === 0) {
        setModelsError("Список моделей пуст. Проверьте тариф или настройки OpenRouter.");
      }
    } catch (error) {
      setModels([]);
      setSelectedModel("");
      setModelsStatus("error");
      setModelsError(error instanceof Error ? error.message : "Не удалось загрузить модели");
    }
  }

  async function loadGallery() {
    setGalleryStatus("loading");

    try {
      const response = await fetch("/api/images?limit=24", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "Не удалось загрузить галерею");
      }

      setGallery((payload?.data ?? []) as ImageGeneration[]);
      setGalleryStatus("ready");
    } catch {
      setGalleryStatus("error");
    }
  }

  useEffect(() => {
    void loadModels();
    void loadGallery();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();

    if (!text || !selectedModel || submitStatus === "loading") return;

    setSubmitStatus("loading");
    setSubmitError("");
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

      const generation = payload.data as ImageGeneration;
      setResult(generation);
      setGallery((current) => [generation, ...current.filter((item) => item.id !== generation.id)]);
      setSubmitStatus("success");
    } catch (error) {
      setSubmitStatus("error");
      setSubmitError(
        error instanceof Error ? error.message : "Не удалось сгенерировать изображение"
      );
    }
  }

  const canSubmit = Boolean(prompt.trim() && selectedModel) && submitStatus !== "loading";

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <form
          className="rounded-3xl border border-white/70 bg-white/78 p-5 shadow-[0_18px_60px_rgba(69,49,40,0.08)] backdrop-blur sm:p-6"
          onSubmit={handleSubmit}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-semibold text-slate-950">Новая генерация</h2>
            <button
              type="button"
              className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:border-primary/30 hover:text-primary"
              onClick={() => void loadModels()}
            >
              Обновить модели
            </button>
          </div>

          <label className="mt-5 block">
            <span className="text-sm font-semibold text-slate-800">Промпт</span>
            <textarea
              className="mt-2 min-h-44 w-full resize-y rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
              placeholder="Опишите сцену, стиль, свет, ракурс и детали."
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={4000}
            />
          </label>

          <div className="mt-4 space-y-4">
            <label className="block">
              <span className="text-sm font-semibold text-slate-800">Модель</span>
              <select
                className="mt-2 h-12 w-full cursor-pointer rounded-2xl border border-slate-200 bg-white/90 px-4 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                disabled={modelsStatus === "loading" || models.length === 0}
              >
                {modelsStatus === "loading" && <option value="">Загружаю модели...</option>}
                {modelsStatus !== "loading" && models.length === 0 && (
                  <option value="">Нет доступных моделей</option>
                )}
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {getModelLabel(model)}
                    {isFreeModel(model) ? " · free" : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className="text-sm font-semibold text-slate-800">Формат</span>
                <select
                  className="mt-2 h-12 w-full cursor-pointer rounded-2xl border border-slate-200 bg-white/90 px-4 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  value={aspectRatio}
                  onChange={(event) => setAspectRatio(event.target.value)}
                >
                  {aspectRatios.map((ratio) => (
                    <option key={ratio} value={ratio}>
                      {ratio}
                    </option>
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
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {modelsError && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {modelsError}
            </div>
          )}

          {submitError && (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {submitError}
            </div>
          )}

          <button
            type="submit"
            className="mt-5 inline-flex min-h-12 w-full cursor-pointer items-center justify-center rounded-2xl bg-primary px-5 text-sm font-bold text-white shadow-[0_18px_30px_rgba(212,122,106,0.24)] transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!canSubmit}
          >
            {submitStatus === "loading" ? "Генерирую..." : "Сгенерировать"}
          </button>
        </form>

        <section className="rounded-3xl border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.82),rgba(249,239,232,0.72))] p-5 shadow-[0_18px_60px_rgba(69,49,40,0.08)] sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-semibold text-slate-950">Результат</h2>
            {result && (
              <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs font-semibold text-slate-600">
                {result.modelId}
              </span>
            )}
          </div>

          <div className="relative mt-5 flex min-h-[420px] items-center justify-center overflow-hidden rounded-3xl border border-white/80 bg-white/65">
            {submitStatus === "loading" ? (
              <div className="text-center text-sm text-slate-500">
                <div className="mx-auto mb-4 size-12 animate-pulse rounded-full bg-primary/25" />
                Генерирую изображение...
              </div>
            ) : result?.fileUrl ? (
              <Image
                fill
                unoptimized
                src={result.fileUrl}
                alt={result.prompt}
                sizes="(max-width: 1280px) 100vw, 780px"
                className="object-contain"
              />
            ) : (
              <span className="px-6 text-center text-sm text-slate-500">
                Изображение появится здесь.
              </span>
            )}
          </div>

          {result && (
            <div className="mt-4 flex flex-wrap gap-2">
              {result.fileUrl && (
                <a
                  className="inline-flex min-h-10 cursor-pointer items-center rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:border-primary/40 hover:text-primary"
                  href={result.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть
                </a>
              )}
              <span className="inline-flex min-h-10 items-center rounded-full bg-white/80 px-4 text-xs font-semibold text-slate-600">
                {result.cost} токенов
              </span>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-3xl border border-white/70 bg-white/72 p-5 shadow-[0_18px_60px_rgba(69,49,40,0.06)] sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-semibold text-slate-950">Галерея</h2>
          <button
            type="button"
            className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:border-primary/30 hover:text-primary"
            onClick={() => void loadGallery()}
          >
            Обновить
          </button>
        </div>

        {galleryStatus === "loading" && (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-64 animate-pulse rounded-3xl bg-white/70" />
            ))}
          </div>
        )}

        {galleryStatus === "error" && (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Не удалось загрузить галерею.
          </div>
        )}

        {galleryStatus === "ready" && gallery.length === 0 && (
          <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center text-sm text-slate-500">
            Пока пусто.
          </div>
        )}

        {gallery.length > 0 && (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {gallery.map((item) => (
              <article
                key={item.id}
                className="group overflow-hidden rounded-3xl border border-white/80 bg-white/80 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-slate-100">
                  {item.fileUrl ? (
                    <Image
                      fill
                      unoptimized
                      src={item.fileUrl}
                      alt={item.prompt}
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      className="object-cover transition duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <span className="text-sm text-slate-400">Нет файла</span>
                  )}
                </div>

                <div className="p-4">
                  <p className="line-clamp-2 text-sm font-semibold leading-5 text-slate-900">
                    {item.prompt}
                  </p>
                  <p className="mt-2 truncate text-xs text-slate-500">{item.modelId}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {new Date(item.createdAt).toLocaleString("ru-RU", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>

                  {item.fileUrl && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a
                        className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-primary/40 hover:text-primary"
                        href={item.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Открыть
                      </a>
                      <a
                        className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-primary/40 hover:text-primary"
                        href={item.fileUrl}
                        download
                      >
                        Скачать
                      </a>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
