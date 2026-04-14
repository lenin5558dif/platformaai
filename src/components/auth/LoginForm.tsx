"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import SsoLoginButton from "@/components/auth/SsoLoginButton";
import TelegramLoginButton from "@/components/auth/TelegramLoginButton";
import {
  evaluateAuthEmailGuardrails,
  getModeText,
  mapLoginError,
  type AuthCapabilities,
  type AuthEmailGuardrails,
  type AuthMode,
  type AuthViewState,
} from "@/lib/auth-ui";

type LoginFormProps = {
  initialMode: AuthMode;
  initialError?: string;
  capabilities: AuthCapabilities;
  emailGuardrails: AuthEmailGuardrails;
};

type AuthFeedback = {
  state: AuthViewState;
  title: string;
  message: string;
  action: "retry" | "use_sso" | "contact_admin" | null;
};

function emitAuthEvent(outcome: string, method: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("platforma:auth", {
      detail: {
        feature: "web-auth-entry",
        method,
        outcome,
      },
    })
  );
}

function fallbackMessage(error?: string | null): AuthFeedback {
  const mapped = mapLoginError(error ?? undefined);
  if (mapped) {
    return mapped;
  }

  return {
    state: "error",
    title: "Не удалось отправить ссылку",
    message: "Проверьте email и попробуйте снова.",
    action: "retry",
  };
}

export default function LoginForm({
  initialMode,
  initialError,
  capabilities,
  emailGuardrails,
}: LoginFormProps) {
  const initialFeedback = useMemo(() => mapLoginError(initialError), [initialError]);
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<AuthViewState>(
    initialFeedback?.state ?? "idle"
  );
  const [feedback, setFeedback] = useState<AuthFeedback | null>(initialFeedback);
  const [telegramUnavailable, setTelegramUnavailable] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const modeText = useMemo(() => getModeText(mode), [mode]);
  const hasAnyMethod = capabilities.email || capabilities.sso || capabilities.telegram;
  const canUseTelegram = capabilities.telegram && !telegramUnavailable;
  const accessCards = [
    {
      key: "email",
      title: "Email link",
      enabled: capabilities.email,
      text:
        mode === "register"
          ? "Создаст web-аккаунт и завершит регистрацию через магическую ссылку."
          : "Быстрый вход без пароля и без отдельного сброса credentials.",
    },
    {
      key: "sso",
      title: "SSO",
      enabled: capabilities.sso,
      text: "Подходит для корпоративного входа через ваш identity provider.",
    },
    {
      key: "telegram",
      title: "Telegram",
      enabled: capabilities.telegram,
      text: "Дополнительный канал входа, который можно подключить позже.",
    },
  ];

  useEffect(() => {
    if (!initialFeedback) {
      return;
    }

    emitAuthEvent(initialFeedback.state === "expired" ? "expired" : "failure", "email");
  }, [initialFeedback]);

  function onModeChange(nextMode: AuthMode) {
    setMode(nextMode);
    setStatus("idle");
    setFeedback(null);
    emailRef.current?.focus();
  }

  function resetToRetry() {
    setStatus("idle");
    setFeedback(null);
    emitAuthEvent("retry", "email");
    emailRef.current?.focus();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email || !capabilities.email) return;

    const emailDecision = evaluateAuthEmailGuardrails(email, emailGuardrails);
    if (emailDecision.blocked) {
      const nextFeedback: AuthFeedback = {
        state: "error",
        title: "Email ограничен политикой доступа",
        message:
          "Для этого адреса или домена вход временно ограничен. Используйте другой корпоративный email или обратитесь к администратору.",
        action: "contact_admin",
      };
      setStatus(nextFeedback.state);
      setFeedback(nextFeedback);
      emitAuthEvent("failure", "email");
      return;
    }

    setStatus("submitting");
    setFeedback(null);
    emitAuthEvent("submit", "email");

    try {
      const result = await signIn("email", {
        email,
        redirect: false,
        callbackUrl: "/",
      });

      if (result?.error) {
        const nextFeedback = fallbackMessage(result.error);
        setStatus(nextFeedback.state);
        setFeedback(nextFeedback);
        emitAuthEvent(nextFeedback.state === "expired" ? "expired" : "failure", "email");
        return;
      }

      setStatus("sent");
      setFeedback({
        state: "sent",
        title: "Ссылка отправлена",
        message:
          mode === "register"
            ? "Проверьте почту и перейдите по ссылке, чтобы завершить регистрацию."
            : "Проверьте почту и перейдите по ссылке для входа.",
        action: "retry",
      });
      emitAuthEvent("success", "email");
      emitAuthEvent("sent", "email");
    } catch {
      const nextFeedback = fallbackMessage();
      setFeedback(nextFeedback);
      setStatus("error");
      emitAuthEvent("failure", "email");
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-text-main mb-2 font-display">
          {modeText.title}
        </h1>
        <p className="text-sm text-text-secondary">{modeText.subtitle}</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {accessCards.map((card) => (
          <div
            key={card.key}
            className={`rounded-xl border px-3 py-3 text-xs ${
              card.enabled
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-gray-200 bg-gray-50 text-gray-400"
            }`}
          >
            <p className="font-semibold">{card.title}</p>
            <p className="mt-1 leading-5">{card.text}</p>
          </div>
        ))}
      </div>

      <div
        className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1"
        role="tablist"
        aria-label="Режим аутентификации"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signin"}
          aria-controls="auth-panel"
          id="auth-tab-signin"
          onClick={() => onModeChange("signin")}
          className={`rounded-md px-3 py-2 text-sm font-medium transition ${
            mode === "signin"
              ? "bg-white text-text-main shadow"
              : "text-text-secondary hover:text-text-main"
          }`}
        >
          Вход
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "register"}
          aria-controls="auth-panel"
          id="auth-tab-register"
          onClick={() => onModeChange("register")}
          className={`rounded-md px-3 py-2 text-sm font-medium transition ${
            mode === "register"
              ? "bg-white text-text-main shadow"
              : "text-text-secondary hover:text-text-main"
          }`}
        >
          Регистрация
        </button>
      </div>

      <div id="auth-panel" role="tabpanel" aria-labelledby={`auth-tab-${mode}`} className="space-y-4">
        {capabilities.email && (
          <form className="space-y-3" onSubmit={handleSubmit}>
            <label className="block text-sm font-medium text-text-main" htmlFor="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              ref={emailRef}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              className="w-full rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              autoComplete="email"
              aria-invalid={status === "error" || status === "expired"}
              aria-describedby={feedback ? "auth-feedback" : undefined}
              required
            />
            <button
              type="submit"
              className="w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
              disabled={status === "submitting"}
            >
              {status === "submitting" ? "Отправляем..." : modeText.emailAction}
            </button>
          </form>
        )}

        {feedback && (
          <div
            id="auth-feedback"
            aria-live="polite"
            className={`rounded-lg border px-3 py-2 text-xs ${
              feedback.state === "error" || feedback.state === "expired"
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            <p className="font-semibold">{feedback.title}</p>
            <p className="mt-1">{feedback.message}</p>
            {feedback.action === "retry" && capabilities.email && (
              <button
                type="button"
                className="mt-2 text-xs font-semibold underline underline-offset-2"
                onClick={resetToRetry}
              >
                Запросить новую ссылку
              </button>
            )}
            {feedback.action === "use_sso" && capabilities.sso && (
              <p className="mt-2">Используйте кнопку SSO ниже для продолжения.</p>
            )}
            {feedback.action === "contact_admin" && (
              <p className="mt-2">Если проблема повторяется, обратитесь к администратору организации.</p>
            )}
          </div>
        )}

        {!capabilities.email && !hasAnyMethod && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Сейчас недоступны способы входа. Обратитесь к администратору.
          </p>
        )}

        {capabilities.sso && (
          <SsoLoginButton
            label={modeText.ssoAction}
            onStarted={() => emitAuthEvent("submit", "sso")}
          />
        )}

        {canUseTelegram && (
          <>
            <div className="my-1 flex items-center gap-3">
              <div className="h-px flex-1 bg-gray-200" />
              <span className="text-xs text-gray-400">или</span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>
            <TelegramLoginButton
              onStarted={() => emitAuthEvent("submit", "telegram")}
              onError={() => {
                setTelegramUnavailable(true);
                emitAuthEvent("failure", "telegram");
              }}
            />
          </>
        )}

        {capabilities.telegram && telegramUnavailable && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Вход через Telegram временно недоступен в этом окружении. Используйте email или SSO.
          </p>
        )}

        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-text-secondary">
            После входа
          </p>
          <div className="mt-2 grid gap-2 text-xs text-text-secondary sm:grid-cols-2">
            <p>Откройте чат или сразу перейдите в организацию для управления командой.</p>
            <p>Если письмо с доступом пришло от коллег, используйте тот же email при входе.</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/org"
              className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover"
            >
              Открыть org
            </Link>
            <Link
              href="/"
              className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-white"
            >
              В чат
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
