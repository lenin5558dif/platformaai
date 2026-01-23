"use client";

import { signIn } from "next-auth/react";

export default function SsoLoginButton() {
  return (
    <button
      type="button"
      onClick={() => void signIn("sso", { callbackUrl: "/" })}
      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
    >
      Войти через SSO
    </button>
  );
}
