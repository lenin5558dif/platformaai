"use client";

import { useState } from "react";

type RevokeState = "idle" | "loading" | "success" | "error";

export default function SessionSecurityCard() {
  const [state, setState] = useState<RevokeState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleRevokeSessions() {
    setState("loading");
    setError(null);

    try {
      const response = await fetch("/api/auth/revoke-all", {
        method: "POST",
      });

      if (!response.ok) {
        setState("error");
        setError("Не удалось завершить активные сессии. Попробуйте снова.");
        return;
      }

      setState("success");
      window.location.assign("/login?mode=signin");
    } catch {
      setState("error");
      setError("Не удалось завершить активные сессии. Попробуйте снова.");
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
      <p className="text-sm font-medium text-text-main">Безопасность сессий</p>
      <p className="mt-2 text-xs text-text-secondary">
        Если есть риск компрометации, завершите все свои веб-сессии и войдите заново.
      </p>
      <button
        type="button"
        onClick={() => void handleRevokeSessions()}
        disabled={state === "loading"}
        className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
      >
        {state === "loading" ? "Завершаем..." : "Завершить все мои сессии"}
      </button>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      {state === "success" ? (
        <p className="mt-2 text-xs text-emerald-700">
          Сессии завершены. Перенаправляем на повторный вход.
        </p>
      ) : null}
    </div>
  );
}
