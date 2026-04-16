"use client";

import { signIn } from "next-auth/react";

type SsoLoginButtonProps = {
  label?: string;
  onStarted?: () => void;
};

export default function SsoLoginButton({
  label = "Войти через SSO",
  onStarted,
}: SsoLoginButtonProps) {
  function handleClick() {
    onStarted?.();
    void signIn("sso", { callbackUrl: "/" });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-all duration-200 ease-out cursor-pointer hover:-translate-y-0.5 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 active:translate-y-0 active:scale-[0.99]"
    >
      {label}
    </button>
  );
}
