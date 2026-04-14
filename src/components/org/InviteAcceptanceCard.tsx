"use client";

import Link from "next/link";
import { useState } from "react";
import { mapInviteError, parseInviteActionResult, type InviteUiMessage } from "@/lib/invite-ui";

type InviteAcceptanceCardProps = {
  token: string;
};

function emitInviteAcceptEvent(outcome: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("platforma:invite", {
      detail: {
        feature: "org-invite-acceptance-ui",
        action: "accept",
        outcome,
      },
    })
  );
}

function bannerClass(tone: InviteUiMessage["tone"]) {
  if (tone === "success") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tone === "warning") return "border-amber-200 bg-amber-50 text-amber-800";
  if (tone === "info") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-red-200 bg-red-50 text-red-700";
}

export default function InviteAcceptanceCard({ token }: InviteAcceptanceCardProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [message, setMessage] = useState<InviteUiMessage | null>(null);

  const hasToken = token.trim().length > 0;

  async function acceptInvite() {
    if (!hasToken) {
      setMessage(mapInviteError("INVALID_TOKEN"));
      setStatus("error");
      return;
    }

    setIsSubmitting(true);
    setStatus("idle");
    setMessage(null);
    emitInviteAcceptEvent("submit");

    try {
      const response = await fetch("/api/org/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const result = await parseInviteActionResult(response);
      if (!result.ok) {
        setMessage(mapInviteError(result.code));
        setStatus("error");
        emitInviteAcceptEvent(result.code === "RATE_LIMITED" ? "rate_limited" : "failure");
        return;
      }

      setMessage({
        title: "Приглашение принято",
        message: "Доступ в организацию успешно предоставлен. Можно перейти к работе.",
        tone: "success",
      });
      setStatus("success");
      emitInviteAcceptEvent("success");
    } catch {
      setMessage(mapInviteError());
      setStatus("error");
      emitInviteAcceptEvent("failure");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-glass-sm space-y-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
            Org invite
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-text-main font-display">
            Принятие приглашения
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Войдите в аккаунт с тем же email, на который отправлено приглашение, затем подтвердите
            действие и сразу откройте организацию.
          </p>
          <p className="mt-2 text-xs text-text-secondary">
            Telegram-only аккаунт без email не сможет принять инвайт.
          </p>
        </div>
        <div className="rounded-2xl border border-white/60 bg-white/70 px-4 py-3 text-xs text-text-secondary">
          <p className="font-semibold text-text-main">Что дальше</p>
          <p className="mt-1">Права, лимиты и cost centers уже будут видны после принятия.</p>
        </div>
      </div>

      {!hasToken && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p className="font-semibold">Нужна ссылка из письма</p>
          <p className="mt-1">
            Откройте письмо-приглашение, войдите тем же email и вернитесь по ссылке с token.
          </p>
        </div>
      )}

      {message && (
        <div className={`rounded-lg border px-3 py-2 text-sm ${bannerClass(message.tone)}`}>
          <p className="font-semibold">{message.title}</p>
          <p className="mt-1">{message.message}</p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        {[
          {
            title: "1. Войти",
            text: "Используйте тот же аккаунт, на который пришёл инвайт.",
          },
          {
            title: "2. Принять",
            text: "Подтвердите приглашение по token из письма.",
          },
          {
            title: "3. Перейти",
            text: "Откройте org и продолжите работу в команде.",
          },
        ].map((item) => (
          <div key={item.title} className="rounded-2xl border border-white/60 bg-white/70 px-4 py-4">
            <p className="text-sm font-semibold text-text-main">{item.title}</p>
            <p className="mt-2 text-xs leading-5 text-text-secondary">{item.text}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          disabled={isSubmitting || !hasToken}
          onClick={() => void acceptInvite()}
        >
          {isSubmitting ? "Проверяем..." : status === "success" ? "Принято" : "Принять приглашение"}
        </button>
        <a
          href="/org"
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-white"
        >
          Перейти в организацию
        </a>
        <Link
          href="/login?mode=signin"
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-white"
        >
          Войти заново
        </Link>
      </div>

      {status === "success" && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Теперь можно открыть организацию или вернуться в чат.
        </p>
      )}
    </div>
  );
}
