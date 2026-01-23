"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">(
    "idle"
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email) return;

    setStatus("loading");
    try {
      const result = await signIn("email", {
        email,
        redirect: false,
        callbackUrl: "/",
      });

      if (result?.error) {
        setStatus("error");
        return;
      }

      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <label className="block text-sm font-medium text-text-main">Email</label>
      <input
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="name@company.com"
        className="w-full rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        required
      />
      <button
        type="submit"
        className="w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        disabled={status === "loading"}
      >
        {status === "loading" ? "Отправляем..." : "Отправить magic link"}
      </button>
      {status === "sent" && (
        <p className="text-xs text-emerald-600">
          Ссылка отправлена. Проверьте почту.
        </p>
      )}
      {status === "error" && (
        <p className="text-xs text-red-500">
          Не удалось отправить письмо. Проверьте email и настройки UniSender.
        </p>
      )}
    </form>
  );
}
