"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type PickerModel = {
  id: string;
  name: string;
  pricing?: Record<string, string | undefined>;
  contextLength?: number;
};

type ModelPickerProps = {
  textModels: PickerModel[];
  imageModels: PickerModel[];
  selectedTextModel?: string;
  selectedImageModel?: string;
  activeTab: "text" | "images";
  triggerLabel?: string;
  align?: "left" | "right";
  onSelectText?: (modelId: string) => void;
  onSelectImage?: (modelId: string) => void;
};

function parsePrice(value?: string) {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatModelPrice(model: PickerModel) {
  const entries = Object.entries(model.pricing ?? {})
    .map(([key, value]) => [key, parsePrice(value)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== null);

  if (!entries.length) return "Цена не указана";
  if (entries.every(([, value]) => value === 0)) return "Бесплатно";

  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}: $${value.toFixed(6)}`)
    .join(" · ");
}

function getModelTitle(model?: PickerModel) {
  if (!model) return "Выбрать модель";
  return model.name || model.id;
}

export default function ModelPicker({
  textModels,
  imageModels,
  selectedTextModel,
  selectedImageModel,
  activeTab,
  triggerLabel,
  align = "right",
  onSelectText,
  onSelectImage,
}: ModelPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState(activeTab);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedModel = useMemo(() => {
    const models = activeTab === "text" ? textModels : imageModels;
    const selectedId = activeTab === "text" ? selectedTextModel : selectedImageModel;
    return models.find((model) => model.id === selectedId);
  }, [activeTab, imageModels, selectedImageModel, selectedTextModel, textModels]);

  const visibleModels = useMemo(() => {
    const models = tab === "text" ? textModels : imageModels;
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return models;
    return models.filter((model) =>
      `${model.name} ${model.id}`.toLowerCase().includes(normalizedQuery)
    );
  }, [imageModels, query, tab, textModels]);

  const tabs = useMemo(() => {
    return [
      { id: "text" as const, label: "Текст", icon: "article", enabled: textModels.length > 0 },
      { id: "images" as const, label: "Изображения", icon: "imagesmode", enabled: imageModels.length > 0 },
    ].filter((item) => item.enabled);
  }, [imageModels.length, textModels.length]);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current?.contains(event.target as Node)) return;
      setIsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) setTab(activeTab);
  }, [activeTab, isOpen]);

  function handleSelect(modelId: string) {
    if (tab === "text") {
      onSelectText?.(modelId);
    } else {
      onSelectImage?.(modelId);
    }
    setIsOpen(false);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        className="inline-flex min-h-10 max-w-[18rem] cursor-pointer items-center justify-center gap-2 rounded-2xl border border-primary/20 bg-white/80 px-3 text-left text-sm font-semibold text-text-primary shadow-sm transition-colors hover:border-primary/40 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        onClick={() => setIsOpen((value) => !value)}
      >
        <span className="material-symbols-outlined text-[18px] text-primary">
          bolt
        </span>
        <span className="truncate">
          {triggerLabel ?? getModelTitle(selectedModel)}
        </span>
        <span className="material-symbols-outlined text-[18px] text-text-secondary">
          expand_more
        </span>
      </button>

      {isOpen && (
        <div
          className={`absolute top-full z-40 mt-3 w-[min(38rem,calc(100vw-1.5rem))] overflow-hidden rounded-3xl border border-white/70 bg-white/95 shadow-[0_24px_80px_rgba(69,49,40,0.20)] backdrop-blur-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div className="flex items-center justify-between gap-3 border-b border-black/5 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-text-primary">Выбор модели</p>
              <p className="truncate text-xs text-text-secondary">
                Текстовая и image-модель выбираются отдельно.
              </p>
            </div>
            <button
              type="button"
              className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary"
              onClick={() => setIsOpen(false)}
              aria-label="Закрыть"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          <div className="space-y-3 p-4">
            {tabs.length > 1 && (
              <div className="grid grid-cols-2 gap-2 rounded-2xl bg-black/5 p-1">
                {tabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors ${
                    tab === item.id
                      ? "bg-white text-primary shadow-sm"
                      : "text-text-secondary hover:bg-white/60 hover:text-text-primary"
                  }`}
                  onClick={() => setTab(item.id as "text" | "images")}
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              ))}
              </div>
            )}

            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-text-secondary">
                search
              </span>
              <input
                className="h-11 w-full rounded-2xl border border-black/10 bg-white/85 pl-9 pr-3 text-sm text-text-primary outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                placeholder="Поиск модели"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>

          <div className="max-h-[22rem] overflow-y-auto px-4 pb-4">
            {visibleModels.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/10 px-4 py-8 text-center text-sm text-text-secondary">
                Нет доступных моделей.
              </div>
            ) : (
              <div className="space-y-2">
                {visibleModels.map((model) => {
                  const selected =
                    tab === "text"
                      ? model.id === selectedTextModel
                      : model.id === selectedImageModel;

                  return (
                    <button
                      key={model.id}
                      type="button"
                      className={`w-full cursor-pointer rounded-2xl border px-4 py-3 text-left transition-colors ${
                        selected
                          ? "border-primary/50 bg-primary/10"
                          : "border-black/5 bg-white/70 hover:border-primary/25 hover:bg-white"
                      }`}
                      onClick={() => handleSelect(model.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-text-primary">
                            {model.name || model.id}
                          </p>
                          <p className="mt-1 truncate text-xs text-text-secondary">
                            {model.id}
                          </p>
                        </div>
                        {selected && (
                          <span className="material-symbols-outlined text-[20px] text-primary">
                            check_circle
                          </span>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-black/5 px-3 py-1 text-[11px] font-semibold text-text-secondary">
                          {formatModelPrice(model)}
                        </span>
                        {tab === "text" && model.contextLength ? (
                          <span className="rounded-full bg-black/5 px-3 py-1 text-[11px] font-semibold text-text-secondary">
                            {model.contextLength.toLocaleString("ru-RU")} ctx
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
