"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import SsoLoginButton from "@/components/auth/SsoLoginButton";
import TelegramLoginButton from "@/components/auth/TelegramLoginButton";
import {
  getModeText,
  mapLoginError,
  type AuthCapabilities,
  type AuthMode,
  type AuthViewState,
} from "@/lib/auth-ui";

type LoginFormProps = {
  initialMode: AuthMode;
  initialError?: string;
  capabilities: AuthCapabilities;
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
}: LoginFormProps) {
  const initialFeedback = useMemo(() => mapLoginError(initialError), [initialError]);
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<AuthViewState>(
    initialFeedback?.state ?? "idle"
  );
  const [feedback, setFeedback] = useState<AuthFeedback | null>(initialFeedback);
  const emailRef = useRef<HTMLInputElement>(null);

  const modeText = useMemo(() => getModeText(mode), [mode]);
  const hasAnyMethod = capabilities.email || capabilities.sso || capabilities.telegram;

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

      setStatus("success");
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
      setStatus("sent");
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

        {capabilities.telegram && (
          <>
            <div className="my-1 flex items-center gap-3">
              <div className="h-px flex-1 bg-gray-200" />
              <span className="text-xs text-gray-400">или</span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>
            <TelegramLoginButton
              onStarted={() => emitAuthEvent("submit", "telegram")}
              onError={() => emitAuthEvent("failure", "telegram")}
            />
          </>
        )}
      </div>
    </div>
  );
}
