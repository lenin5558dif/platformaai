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

function fallbackLoginMessage(error?: string | null): AuthFeedback {
  const mapped = mapLoginError(error ?? undefined);
  if (mapped) {
    return mapped;
  }

  return {
    state: "error",
    title: "Не удалось выполнить вход",
    message: "Проверьте email и пароль, затем попробуйте снова.",
    action: "retry",
  };
}

function mapRegisterError(message?: string): AuthFeedback {
  const normalized = (message ?? "").toLowerCase();
  if (normalized.includes("already exists")) {
    return {
      state: "error",
      title: "Email уже используется",
      message: "У этого email уже есть аккаунт. Войдите через вкладку «Вход».",
      action: "retry",
    };
  }
  if (normalized.includes("passwords do not match")) {
    return {
      state: "error",
      title: "Пароли не совпадают",
      message: "Проверьте поля «Пароль» и «Повторите пароль».",
      action: "retry",
    };
  }
  return {
    state: "error",
    title: "Не удалось зарегистрироваться",
    message: message || "Проверьте данные и попробуйте снова.",
    action: "retry",
  };
}

function mapRegisterSuccess(params: {
  email: string;
  verificationSent?: boolean;
}): AuthFeedback {
  if (params.verificationSent) {
    return {
      state: "success",
      title: "Аккаунт создан",
      message: `Мы отправили письмо на ${params.email}. Подтвердите email, затем войдите в аккаунт.`,
      action: null,
    };
  }

  return {
    state: "success",
    title: "Аккаунт создан",
    message:
      "Аккаунт создан, но письмо подтверждения пока не отправилось. Попробуйте войти и запросить письмо повторно в настройках.",
    action: null,
  };
}

export default function LoginForm({
  initialMode,
  initialError,
  capabilities,
}: LoginFormProps) {
  const initialFeedback = useMemo(() => mapLoginError(initialError), [initialError]);
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<AuthViewState>(
    initialFeedback?.state ?? "idle"
  );
  const [feedback, setFeedback] = useState<AuthFeedback | null>(initialFeedback);
  const emailRef = useRef<HTMLInputElement>(null);

  const modeText = useMemo(() => getModeText(mode), [mode]);
  const hasAnyMethod = capabilities.email || capabilities.sso;
  const showTelegramWidget = capabilities.telegram;

  useEffect(() => {
    if (!initialFeedback) {
      return;
    }

    emitAuthEvent(initialFeedback.state === "expired" ? "expired" : "failure", "credentials");
  }, [initialFeedback]);

  function onModeChange(nextMode: AuthMode) {
    setMode(nextMode);
    setStatus("idle");
    setFeedback(null);
    setPassword("");
    setConfirmPassword("");
    emailRef.current?.focus();
  }

  function resetToRetry() {
    setStatus("idle");
    setFeedback(null);
    emitAuthEvent("retry", "credentials");
    emailRef.current?.focus();
  }

  async function signInWithPassword(nextEmail: string, nextPassword: string) {
    const result = await signIn("credentials", {
      email: nextEmail.trim().toLowerCase(),
      password: nextPassword,
      redirect: false,
      callbackUrl: "/",
    });

    if (result?.error) {
      const nextFeedback = fallbackLoginMessage(result.error);
      setStatus(nextFeedback.state);
      setFeedback(nextFeedback);
      emitAuthEvent("failure", "credentials");
      return;
    }

    setStatus("success");
    setFeedback({
      state: "success",
      title: "Вход выполнен",
      message: "Перенаправляем в чат...",
      action: null,
    });
    emitAuthEvent("success", "credentials");
    window.location.assign(result?.url ?? "/");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!capabilities.email) return;

    setStatus("submitting");
    setFeedback(null);

    const normalizedEmail = email.trim().toLowerCase();
    const trimmedNickname = nickname.trim();

    if (!normalizedEmail || !password) {
      setStatus("error");
      setFeedback({
        state: "error",
          title: "Заполните форму",
        message: "Email и пароль обязательны.",
        action: "retry",
      });
      return;
    }

    if (mode === "register") {
      if (trimmedNickname.length < 2) {
        setStatus("error");
        setFeedback({
          state: "error",
          title: "Нужен никнейм",
          message: "Введите никнейм длиной не менее 2 символов.",
          action: "retry",
        });
        return;
      }

      if (password !== confirmPassword) {
        setStatus("error");
        setFeedback({
          state: "error",
          title: "Пароли не совпадают",
          message: "Проверьте поля «Пароль» и «Повторите пароль».",
          action: "retry",
        });
        return;
      }

      if (password.length < 8) {
        setStatus("error");
        setFeedback({
          state: "error",
          title: "Слабый пароль",
          message: "Минимальная длина пароля - 8 символов.",
          action: "retry",
        });
        return;
      }

      emitAuthEvent("submit", "register");
      try {
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nickname: trimmedNickname,
            email: normalizedEmail,
            password,
            confirmPassword,
          }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as {
            message?: string;
          };
          const nextFeedback = mapRegisterError(payload.message);
          setStatus(nextFeedback.state);
          setFeedback(nextFeedback);
          emitAuthEvent("failure", "register");
          return;
        }

        const payload = (await response.json().catch(() => ({}))) as {
          data?: {
            email?: string;
            verificationSent?: boolean;
          };
        };

        const successFeedback = mapRegisterSuccess({
          email: payload?.data?.email ?? normalizedEmail,
          verificationSent: payload?.data?.verificationSent,
        });
        setMode("signin");
        setConfirmPassword("");
        setPassword("");
        setStatus(successFeedback.state);
        setFeedback(successFeedback);
        emitAuthEvent("success", "register");
      } catch {
        const nextFeedback = mapRegisterError();
        setStatus(nextFeedback.state);
        setFeedback(nextFeedback);
        emitAuthEvent("failure", "register");
      }
      return;
    }

    emitAuthEvent("submit", "credentials");
    try {
      await signInWithPassword(normalizedEmail, password);
    } catch {
      const nextFeedback = fallbackLoginMessage();
      setFeedback(nextFeedback);
      setStatus("error");
      emitAuthEvent("failure", "credentials");
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

      <div
        id="auth-panel"
        role="tabpanel"
        aria-labelledby={`auth-tab-${mode}`}
        className="space-y-4"
      >
        {capabilities.email && (
          <form className="space-y-3" onSubmit={handleSubmit}>
            {mode === "register" && (
              <div>
                <label
                  className="mb-1 block text-sm font-medium text-text-main"
                  htmlFor="auth-nickname"
                >
                  Никнейм
                </label>
                <input
                  id="auth-nickname"
                  type="text"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder="ваш_никнейм"
                  className="w-full rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  autoComplete="nickname"
                  required
                />
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-text-main" htmlFor="auth-email">
                Электронная почта
              </label>
              <input
                id="auth-email"
                ref={emailRef}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.ru"
                className="w-full rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                autoComplete="email"
                aria-invalid={status === "error" || status === "expired"}
                aria-describedby={feedback ? "auth-feedback" : undefined}
                required
              />
            </div>

            <div>
              <label
                className="mb-1 block text-sm font-medium text-text-main"
                htmlFor="auth-password"
              >
                Пароль
              </label>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Минимум 8 символов"
                className="w-full rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                required
              />
            </div>

            {mode === "register" && (
              <div>
                <label
                  className="mb-1 block text-sm font-medium text-text-main"
                  htmlFor="auth-confirm-password"
                >
                  Повторите пароль
                </label>
                <input
                  id="auth-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Повторите пароль"
                  className="w-full rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  autoComplete="new-password"
                  required
                />
              </div>
            )}

            <button
              type="submit"
              className="w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
              disabled={status === "submitting"}
            >
              {status === "submitting" ? "Обработка..." : modeText.emailAction}
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
                Попробовать снова
              </button>
            )}
            {feedback.action === "use_sso" && capabilities.sso && (
              <p className="mt-2">Используйте кнопку SSO ниже для продолжения.</p>
            )}
            {feedback.action === "contact_admin" && (
              <p className="mt-2">
                Если проблема повторяется, обратитесь к администратору организации.
              </p>
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

        <div className="my-1 flex items-center gap-3">
          <div className="h-px flex-1 bg-gray-200" />
          <span className="text-xs text-gray-400">Telegram</span>
          <div className="h-px flex-1 bg-gray-200" />
        </div>

        {showTelegramWidget ? (
          <TelegramLoginButton
            onStarted={() => emitAuthEvent("submit", "telegram")}
          />
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <p className="font-semibold">Вход через Telegram недоступен</p>
            <p className="mt-1">
              Сервис временно недоступен в этом окружении. Сейчас используйте email + пароль.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
