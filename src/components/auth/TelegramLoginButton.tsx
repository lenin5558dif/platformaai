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
  const onStartedRef = useRef(onStarted);
  const onErrorRef = useRef(onError);
  const [isUnavailable, setIsUnavailable] = useState(false);

  useEffect(() => {
    onStartedRef.current = onStarted;
    onErrorRef.current = onError;
  }, [onError, onStarted]);

  useEffect(() => {
    const botName = process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME;

    if (!botName) {
      setIsUnavailable(true);
      onErrorRef.current?.();
      return;
    }

    (window as typeof window & { onTelegramAuth?: (user: unknown) => void }).onTelegramAuth =
      (user) => {
        onStartedRef.current?.();
        void signIn("telegram", {
          data: JSON.stringify(user),
          callbackUrl: "/",
        });
      };

    if (!ref.current) {
      return;
    }

    ref.current.innerHTML = "";
    const observer = new MutationObserver(() => {
      const text = ref.current?.textContent?.toLowerCase() ?? "";
      if (text.includes("bot domain invalid") || text.includes("domain invalid")) {
        setIsUnavailable(true);
        if (ref.current) {
          ref.current.innerHTML = "";
        }
        onErrorRef.current?.();
      }
    });

    observer.observe(ref.current, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.onerror = () => {
      setIsUnavailable(true);
      onErrorRef.current?.();
    };
    script.setAttribute("data-telegram-login", botName);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    ref.current.appendChild(script);

    return () => {
      observer.disconnect();
      (window as typeof window & { onTelegramAuth?: (user: unknown) => void }).onTelegramAuth =
        undefined;
    };
  }, []);

  if (isUnavailable) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div ref={ref} />
    </div>
  );
}
