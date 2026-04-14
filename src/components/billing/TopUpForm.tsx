"use client";

import { useState } from "react";

export default function TopUpForm() {
  const [credits, setCredits] = useState(100);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!credits || credits <= 0) return;

    setStatus("loading");
    setError(null);

    try {
      const response = await fetch("/api/payments/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credits }),
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus("error");
        setError(data?.error ?? "Ошибка создания оплаты.");
        return;
      }

      if (data?.url) {
        window.location.href = data.url;
        return;
      }

      setStatus("error");
      setError("Не удалось получить ссылку на оплату.");
    } catch {
      setStatus("error");
      setError("Не удалось создать оплату.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="block text-xs text-text-secondary">
        Пополнение баланса (кредиты)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={10}
          step={10}
          value={credits}
          onChange={(event) => setCredits(Number(event.target.value))}
          className="w-32 rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {status === "loading" ? "Создаем..." : "Оплатить"}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </form>
  );
}
