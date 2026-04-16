"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";

type TelegramLoginButtonProps = {
  onStarted?: () => void;
  onError?: () => void;
};

type LoginStatus = "idle" | "starting" | "waiting" | "signing-in" | "error";

type CreateLoginTokenResponse = {
  token: string;
  deepLink: string;
  appDeepLink: string;
};

type PollResponse =
  | { state: "pending" }
  | { state: "ready" }
  | { state: "error"; code: string };

function getErrorMessage(code?: string) {
  switch (code) {
    case "ACCOUNT_INACTIVE":
      return "Этот аккаунт отключен. Обратитесь к администратору.";
    case "TOKEN_EXPIRED":
      return "Ссылка для входа истекла. Запросите новую и попробуйте снова.";
    case "TELEGRAM_LOGIN_DISABLED":
      return "Вход через Telegram временно недоступен в этом окружении.";
    default:
      return "Не удалось завершить вход через Telegram. Попробуйте снова.";
  }
}

function TelegramIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M21.4 4.58L18.4 18.72C18.18 19.72 17.6 19.96 16.78 19.52L12.2 16.14L9.98 18.28C9.74 18.52 9.54 18.72 9.08 18.72L9.42 14.04L17.94 6.34C18.3 6.02 17.86 5.84 17.38 6.16L6.86 12.78L2.34 11.38C1.36 11.08 1.34 10.4 2.54 9.92L20.22 3.1C21.04 2.8 21.76 3.28 21.4 4.58Z"
        fill="currentColor"
      />
    </svg>
  );
}

function buildPopupFeatures() {
  const width = 520;
  const height = 760;
  const left = Math.max(0, Math.round((window.screen.width - width) / 2));
  const top = Math.max(0, Math.round((window.screen.height - height) / 2));

  return [
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    "popup=yes",
    "resizable=yes",
    "scrollbars=yes",
  ].join(",");
}

export default function TelegramLoginButton({
  onStarted,
  onError,
}: TelegramLoginButtonProps) {
  const [status, setStatus] = useState<LoginStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pollToken, setPollToken] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const signInTriggeredRef = useRef(false);

  useEffect(() => {
    if (!pollToken) {
      return;
    }

    signInTriggeredRef.current = false;
    const controller = new AbortController();
    let timer: number | null = null;

    const poll = async () => {
      try {
        const response = await fetch(
          `/api/auth/telegram/login-token?token=${encodeURIComponent(pollToken)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          }
        );

        const payload = (await response.json()) as PollResponse;
        if (payload.state === "pending") {
          setStatus("waiting");

          if (popupRef.current?.closed) {
            timer = window.setTimeout(poll, 1500);
            return;
          }

          timer = window.setTimeout(poll, 2000);
          return;
        }

        if (payload.state === "error") {
          setStatus("error");
          setPollToken(null);
          setErrorMessage(getErrorMessage(payload.code));
          popupRef.current?.close();
          return;
        }

        if (signInTriggeredRef.current) {
          return;
        }

        signInTriggeredRef.current = true;
        setStatus("signing-in");
        const result = await signIn("telegram-login", {
          loginToken: pollToken,
          redirect: false,
          callbackUrl: "/",
        });

        if (result?.error) {
          setStatus("error");
          setPollToken(null);
          setErrorMessage(getErrorMessage(result.error));
          popupRef.current?.close();
          return;
        }

        popupRef.current?.close();
        window.location.assign(result?.url ?? "/");
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setStatus("error");
        setPollToken(null);
        setErrorMessage(getErrorMessage());
      }
    };

    void poll();

    return () => {
      controller.abort();
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [pollToken]);

  async function handleClick() {
    setStatus("starting");
    setErrorMessage(null);

    const popup = window.open(
      "",
      "platformaai-telegram-login",
      buildPopupFeatures()
    );

    if (!popup) {
      onError?.();
      setStatus("error");
      setErrorMessage(
        "Браузер заблокировал дополнительное окно. Разрешите pop-up для этого сайта и попробуйте снова."
      );
      return;
    }

    popupRef.current = popup;
    popup.document.write(
      "<!doctype html><title>Telegram Login</title><body style='font-family:system-ui;padding:24px'>Открываем Telegram…</body>"
    );
    popup.document.close();
    popup.focus();

    try {
      const response = await fetch("/api/auth/telegram/login-token", {
        method: "POST",
        cache: "no-store",
      });
      const payload = (await response.json()) as
        | CreateLoginTokenResponse
        | { code?: string };

      if (!response.ok || !("token" in payload)) {
        popup.close();
        setStatus("error");
        setErrorMessage(getErrorMessage("code" in payload ? payload.code : undefined));
        onError?.();
        return;
      }

      onStarted?.();
      setPollToken(payload.token);
      setStatus("waiting");

      popup.location.replace(payload.deepLink);
    } catch {
      popup.close();
      setStatus("error");
      setErrorMessage(getErrorMessage());
      onError?.();
    }
  }

  const buttonLabel =
    status === "starting"
      ? "Открываем Telegram..."
      : status === "waiting"
        ? "Ожидаем подтверждение в Telegram"
        : status === "signing-in"
          ? "Завершаем вход..."
          : "Войти или зарегистрироваться через Telegram";

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={status === "starting" || status === "signing-in"}
        aria-busy={status === "starting" || status === "signing-in"}
        className="flex min-h-11 w-full items-center justify-center gap-3 rounded-xl bg-[#4da3ff] px-4 py-3 text-base font-semibold text-white shadow-[0_14px_30px_rgba(77,163,255,0.28)] transition-all duration-200 ease-out cursor-pointer hover:-translate-y-0.5 hover:bg-[#2f94ff] hover:shadow-[0_18px_36px_rgba(77,163,255,0.34)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4da3ff]/30 active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:shadow-[0_14px_30px_rgba(77,163,255,0.28)]"
      >
        <TelegramIcon />
        <span>{buttonLabel}</span>
      </button>

      <p className="text-center text-sm leading-relaxed text-text-secondary">
        Откроется отдельное окно со страницей входа Telegram. Текущая страница сервиса останется открытой.
      </p>

      {errorMessage ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800">
          <p className="font-semibold">Вход через Telegram не завершен</p>
          <p className="mt-1">{errorMessage}</p>
        </div>
      ) : null}
    </div>
  );
}
