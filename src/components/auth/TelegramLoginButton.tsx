"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";

type TelegramLoginButtonProps = {
  onStarted?: () => void;
  onError?: () => void;
};

export default function TelegramLoginButton({
  onStarted,
  onError,
}: TelegramLoginButtonProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const botName = process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME;

    if (!botName) {
      setError("Telegram bot name не задан.");
      onError?.();
      return;
    }

    (window as typeof window & { onTelegramAuth?: (user: unknown) => void }).onTelegramAuth =
      (user) => {
        onStarted?.();
        void signIn("credentials", {
          data: JSON.stringify(user),
          callbackUrl: "/",
        });
      };

    if (!ref.current) {
      return;
    }

    ref.current.innerHTML = "";
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botName);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    ref.current.appendChild(script);
  }, [onError, onStarted]);

  return (
    <div className="space-y-2">
      <div ref={ref} />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
