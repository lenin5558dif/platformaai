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
      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
    >
      {label}
    </button>
  );
}
