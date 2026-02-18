"use client";

import { useMemo, useState } from "react";
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
  const [message, setMessage] = useState<InviteUiMessage | null>(null);

  const hasToken = useMemo(() => token.trim().length > 0, [token]);

  async function acceptInvite() {
    if (!hasToken) {
      setMessage(mapInviteError("INVALID_TOKEN"));
      return;
    }

    setIsSubmitting(true);
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
        emitInviteAcceptEvent(result.code === "RATE_LIMITED" ? "rate_limited" : "failure");
        return;
      }

      setMessage({
        title: "Приглашение принято",
        message: "Доступ в организацию успешно предоставлен. Можно перейти к работе.",
        tone: "success",
      });
      emitInviteAcceptEvent("success");
    } catch {
      setMessage(mapInviteError());
      emitInviteAcceptEvent("failure");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6 space-y-4">
      <h1 className="text-2xl font-semibold text-text-main font-display">Принятие приглашения</h1>
      <p className="text-sm text-text-secondary">
        Войдите в аккаунт с тем же email, на который отправлено приглашение, затем подтвердите действие.
      </p>

      {message && (
        <div className={`rounded-lg border px-3 py-2 text-sm ${bannerClass(message.tone)}`}>
          <p className="font-semibold">{message.title}</p>
          <p className="mt-1">{message.message}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          disabled={isSubmitting}
          onClick={() => void acceptInvite()}
        >
          {isSubmitting ? "Проверяем..." : "Принять приглашение"}
        </button>
        <a
          href="/org"
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-white"
        >
          Перейти в организацию
        </a>
      </div>
    </div>
  );
}
