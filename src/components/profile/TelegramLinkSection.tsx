"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  emitTelegramLinkingEvent,
  mapTelegramLinkingError,
  maskedIdentityHint,
  type TelegramLinkUiMessage,
  type TelegramLinkViewState,
} from "@/lib/telegram-linking-ui";

type TelegramTokenResponse = {
  token?: string | null;
  deepLink?: string | null;
  expiresAt?: string | null;
  maskedEmail?: string | null;
  orgName?: string | null;
  error?: string | null;
};

type TelegramErrorResponse = {
  code?: string | null;
  error?: string | null;
};

type TelegramStatusResponse = {
  state?: "idle" | "awaiting_bot_confirmation" | "linked" | "error";
  code?: string | null;
  expiresAt?: string | null;
  telegramId?: string | null;
  maskedEmail?: string | null;
  orgName?: string | null;
  error?: string | null;
};

function MessageBanner({ message }: { message: TelegramLinkUiMessage | null }) {
  if (!message) {
    return null;
  }

  const toneClass =
    message.tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : message.tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : message.tone === "info"
          ? "border-sky-200 bg-sky-50 text-sky-700"
          : "border-red-200 bg-red-50 text-red-700";

  return (
    <div className={`mb-3 rounded-lg border px-3 py-2 text-xs ${toneClass}`} aria-live="polite">
      <p className="font-semibold">{message.title}</p>
      <p className="mt-1">{message.message}</p>
    </div>
  );
}

export default function TelegramLinkSection(params: {
  telegramId?: string | null;
}) {
  const [viewState, setViewState] = useState<TelegramLinkViewState>(
    params.telegramId ? "linked" : "idle"
  );
  const [token, setToken] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [telegramId, setTelegramId] = useState<string | null>(params.telegramId ?? null);
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [message, setMessage] = useState<TelegramLinkUiMessage | null>(null);
  const [loading, setLoading] = useState(false);

  const identityHint = useMemo(() => maskedIdentityHint(maskedEmail, orgName), [maskedEmail, orgName]);

  const checkStatus = useCallback(async () => {
    if (!token) {
      return;
    }

    try {
      const url = `/api/telegram/token?token=${encodeURIComponent(token)}`;
      const res = await fetch(url, { method: "GET", cache: "no-store" });
      const body = (await res.json().catch(() => null)) as TelegramStatusResponse | null;

      if (!res.ok) {
        setViewState("error");
        setMessage(mapTelegramLinkingError(body?.code ?? body?.error ?? String(res.status)));
        emitTelegramLinkingEvent("confirm_link", "failure");
        return;
      }

      if (body?.maskedEmail) {
        setMaskedEmail(body.maskedEmail);
      }
      if (body?.orgName) {
        setOrgName(body.orgName);
      }

      if (body?.state === "linked") {
        setTelegramId(body.telegramId ?? telegramId);
        setViewState("linked");
        setMessage({
          tone: "success",
          title: "Telegram подключен",
          message: "Привязка подтверждена. Telegram доступ активирован для вашего профиля.",
        });
        emitTelegramLinkingEvent("confirm_link", "success");
        return;
      }

      if (body?.state === "awaiting_bot_confirmation") {
        setViewState("awaiting_bot_confirmation");
        return;
      }

      if (body?.state === "error") {
        setViewState("error");
        setMessage(mapTelegramLinkingError(body.code ?? body.error ?? undefined));
        emitTelegramLinkingEvent("confirm_link", body?.code === "TOKEN_EXPIRED" ? "expired" : "failure");
      }
    } catch {
      setViewState("error");
      setMessage(mapTelegramLinkingError());
      emitTelegramLinkingEvent("confirm_link", "failure");
    }
  }, [telegramId, token]);

  useEffect(() => {
    if (!token || viewState !== "awaiting_bot_confirmation") {
      return;
    }

    const id = setInterval(() => {
      void checkStatus();
    }, 5000);

    return () => clearInterval(id);
  }, [checkStatus, token, viewState]);

  const generate = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    emitTelegramLinkingEvent("create_link", "submit");

    try {
      const res = await fetch("/api/telegram/token", { method: "POST" });
      const body = (await res.json().catch(() => null)) as TelegramTokenResponse | null;
      if (!res.ok) {
        setViewState("error");
        setMessage(mapTelegramLinkingError(body?.error ?? String(res.status)));
        emitTelegramLinkingEvent("create_link", res.status === 429 ? "rate_limited" : "failure");
        return;
      }

      setToken(body?.token ?? null);
      setDeepLink(body?.deepLink ?? null);
      setExpiresAt(body?.expiresAt ?? null);
      setMaskedEmail(body?.maskedEmail ?? null);
      setOrgName(body?.orgName ?? null);
      setViewState("link_generated");
      setMessage({
        tone: "info",
        title: "Ссылка готова",
        message: "Откройте Telegram по ссылке и подтвердите привязку в боте.",
      });
      emitTelegramLinkingEvent("create_link", "success");

      void checkStatus();
    } catch {
      setViewState("error");
      setMessage(mapTelegramLinkingError());
      emitTelegramLinkingEvent("create_link", "failure");
    } finally {
      setLoading(false);
    }
  }, [checkStatus]);

  const unlink = useCallback(async () => {
    const confirmed = window.confirm("Отключить Telegram? Доступ бота будет немедленно отозван.");
    if (!confirmed) {
      return;
    }

    setLoading(true);
    setMessage(null);
    emitTelegramLinkingEvent("unlink", "submit");

    try {
      const res = await fetch("/api/telegram/unlink", { method: "DELETE" });
      if (res.status !== 204) {
        const body = (await res.json().catch(() => null)) as TelegramErrorResponse | null;
        setViewState("error");
        setMessage(mapTelegramLinkingError(body?.code ?? body?.error ?? String(res.status)));
        emitTelegramLinkingEvent("unlink", res.status === 429 ? "rate_limited" : "failure");
        return;
      }

      setTelegramId(null);
      setToken(null);
      setDeepLink(null);
      setExpiresAt(null);
      setViewState("unlinked");
      setMessage({
        tone: "success",
        title: "Telegram отключен",
        message: "Доступ бота немедленно отозван. При необходимости можно привязать заново.",
      });
      emitTelegramLinkingEvent("unlink", "success");
    } catch {
      setViewState("error");
      setMessage(mapTelegramLinkingError());
      emitTelegramLinkingEvent("unlink", "failure");
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="mt-6 rounded-xl border border-gray-200 bg-white/70 p-4">
      <p className="text-sm font-medium text-text-main mb-2">Привязка Telegram</p>
      <p className="text-xs text-text-secondary mb-3">
        Сгенерируйте одноразовую ссылку и перейдите по ней в Telegram. Подтвердите действие в
        боте, после чего статус обновится автоматически.
      </p>

      {telegramId ? (
        <p className="text-xs text-text-secondary mb-3">Текущий Telegram ID: {telegramId}</p>
      ) : (
        <p className="text-xs text-text-secondary mb-3">Telegram не привязан.</p>
      )}

      {(viewState === "awaiting_bot_confirmation" || token) && (
        <p className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">
          Подтверждение ожидается для аккаунта: <span className="font-medium">{identityHint}</span>
        </p>
      )}

      {viewState === "awaiting_bot_confirmation" && (
        <p className="mb-3 text-xs text-text-secondary">
          Ожидаем подтверждение в Telegram. Если уже подтвердили, нажмите &quot;Проверить статус&quot;.
        </p>
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

      <MessageBanner message={message} />

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
          disabled={loading || !token}
          onClick={() => void checkStatus()}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-text-main hover:bg-gray-50 disabled:opacity-50"
        >
          Проверить статус
        </button>

        <button
          type="button"
          disabled={loading || !telegramId}
          onClick={unlink}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-text-main hover:bg-gray-50 disabled:opacity-50"
        >
          Отключить Telegram
        </button>
      </div>
    </div>
  );
}
