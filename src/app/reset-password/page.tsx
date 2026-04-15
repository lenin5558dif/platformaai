"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type VerifyState =
  | { status: "loading" }
  | { status: "invalid"; message: string }
  | { status: "valid"; email: string | null; expiresAt: string };

function ResetPasswordContent() {
  const params = useSearchParams();
  const token = (params.get("token") ?? "").trim();
  const [verifyState, setVerifyState] = useState<VerifyState>({
    status: "loading",
  });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function verifyToken() {
      if (!token) {
        setVerifyState({
          status: "invalid",
          message: "Ссылка для сброса пароля неполная.",
        });
        return;
      }

      try {
        const response = await fetch(
          `/api/auth/password-reset/verify?token=${encodeURIComponent(token)}`,
          {
            cache: "no-store",
          }
        );
        const payload = (await response.json().catch(() => ({}))) as {
          valid?: boolean;
          reason?: string;
          email?: string | null;
          expiresAt?: string;
        };

        if (!isMounted) return;

        if (!response.ok || !payload.valid) {
          const reason = payload.reason ?? "TOKEN_INVALID";
          const message =
            reason === "TOKEN_EXPIRED"
              ? "Срок действия ссылки истек."
              : reason === "TOKEN_USED"
              ? "Эта ссылка уже была использована."
              : "Ссылка недействительна.";
          setVerifyState({ status: "invalid", message });
          return;
        }

        setVerifyState({
          status: "valid",
          email: payload.email ?? null,
          expiresAt: payload.expiresAt ?? "",
        });
      } catch {
        if (!isMounted) return;
        setVerifyState({
          status: "invalid",
          message: "Не удалось проверить ссылку. Повторите позже.",
        });
      }
    }

    void verifyToken();
    return () => {
      isMounted = false;
    };
  }, [token]);

  const canSubmit = useMemo(
    () =>
      verifyState.status === "valid" &&
      password.length >= 8 &&
      confirmPassword.length >= 8 &&
      !isSubmitting,
    [verifyState.status, password, confirmPassword, isSubmitting]
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          password,
          confirmPassword,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        if (payload.error === "TOKEN_INVALID_OR_EXPIRED") {
          setError("Ссылка недействительна или срок ее действия уже истек.");
        } else {
          setError("Не удалось обновить пароль. Проверьте данные и попробуйте снова.");
        }
        return;
      }

      setResult("Пароль успешно обновлен. Теперь вы можете войти в аккаунт.");
      setPassword("");
      setConfirmPassword("");
    } catch {
      setError("Сбой сети при обновлении пароля.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6 space-y-4">
        <h1 className="text-2xl font-semibold text-text-main font-display">
          Сброс пароля
        </h1>

        {verifyState.status === "loading" && (
          <p className="text-sm text-text-secondary">Проверяем ссылку...</p>
        )}

        {verifyState.status === "invalid" && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {verifyState.message}
          </div>
        )}

        {verifyState.status === "valid" && (
          <>
            <p className="text-sm text-text-secondary">
              {verifyState.email
                ? `Аккаунт: ${verifyState.email}`
                : "Подтвердите новый пароль для аккаунта."}
            </p>
            <form className="space-y-3" onSubmit={handleSubmit}>
              <div>
                <label className="mb-1 block text-sm font-medium text-text-main">
                  Новый пароль
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  autoComplete="new-password"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-text-main">
                  Повторите пароль
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  autoComplete="new-password"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
              >
                {isSubmitting ? "Обработка..." : "Сохранить новый пароль"}
              </button>
            </form>
          </>
        )}

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}
        {result && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {result}
          </div>
        )}

        <div className="pt-2">
          <Link
            href="/login?mode=signin"
            className="text-sm font-medium text-primary hover:text-primary-hover"
          >
            Вернуться ко входу
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center px-6">
          <div className="w-full max-w-md rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
            <p className="text-sm text-text-secondary">Проверяем ссылку...</p>
          </div>
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
