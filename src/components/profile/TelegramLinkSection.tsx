"use client";

import { useCallback, useState } from "react";

export default function TelegramLinkSection(params: {
  telegramId?: string | null;
}) {
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/telegram/token", { method: "POST" });
      const body = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        setError(body?.error ?? "Не удалось сгенерировать ссылку");
        return;
      }

      setDeepLink(body?.deepLink ?? null);
      setExpiresAt(body?.expiresAt ?? null);
    } catch {
      setError("Не удалось сгенерировать ссылку");
    } finally {
      setLoading(false);
    }
  }, []);

  const unlink = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/telegram/unlink", { method: "DELETE" });
      if (res.status !== 204) {
        const body = (await res.json().catch(() => null)) as any;
        setError(body?.error ?? "Не удалось отвязать Telegram");
        return;
      }

      // UI-only: we can't update server-rendered telegramId without reload.
      setDeepLink(null);
      setExpiresAt(null);
    } catch {
      setError("Не удалось отвязать Telegram");
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="mt-6 rounded-xl border border-gray-200 bg-white/70 p-4">
      <p className="text-sm font-medium text-text-main mb-2">Привязка Telegram</p>
      <p className="text-xs text-text-secondary mb-3">
        Сгенерируйте ссылку и перейдите по ней в Telegram. Ссылка действует 10 минут.
      </p>

      {params.telegramId ? (
        <p className="text-xs text-text-secondary mb-3">Текущий Telegram ID: {params.telegramId}</p>
      ) : (
        <p className="text-xs text-text-secondary mb-3">Telegram не привязан.</p>
      )}

      {deepLink ? (
        <div className="mb-3 text-xs text-text-main">
          <span className="font-medium">Deep link:</span>{" "}
          <a className="text-primary underline" href={deepLink}>
            {deepLink}
          </a>
          {expiresAt ? (
            <div className="mt-1 text-xs text-text-secondary">Действует до: {expiresAt}</div>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-text-secondary mb-3">Активной ссылки нет.</p>
      )}

      {error ? <div className="mb-3 text-xs text-red-600">{error}</div> : null}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={loading}
          onClick={generate}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
        >
          Сгенерировать ссылку
        </button>

        <button
          type="button"
          disabled={loading || !params.telegramId}
          onClick={unlink}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-text-main hover:bg-gray-50 disabled:opacity-50"
        >
          Отключить Telegram
        </button>
      </div>
    </div>
  );
}
