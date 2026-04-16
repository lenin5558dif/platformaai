"use client";

import { useState } from "react";
import {
  getPaidBillingTierOptions,
  type BillingTier,
} from "@/lib/billing-tiers";

const PAID_TIERS = getPaidBillingTierOptions();

type TopUpFormProps = {
  disabled?: boolean;
  notice?: string | null;
};

export default function TopUpForm({
  disabled = false,
  notice = null,
}: TopUpFormProps) {
  const [billingTier, setBillingTier] = useState<BillingTier>(PAID_TIERS[0]?.id ?? "tier_500");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (disabled) return;

    setStatus("loading");
    setError(null);

    try {
      const response = await fetch("/api/payments/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingTier }),
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus("error");
        setError(data?.error ?? "Ошибка создания оплаты.");
        return;
      }

      if (data?.url) {
        window.location.href = data.url;
        return;
      }

      setStatus("error");
      setError("Не удалось получить ссылку на оплату.");
    } catch {
      setStatus("error");
      setError("Не удалось создать оплату.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="block text-xs text-text-secondary">
        Тариф и пополнение
      </label>
      <div className="grid gap-3 md:grid-cols-3">
        {PAID_TIERS.map((tier) => {
          const selected = tier.id === billingTier;
          return (
            <button
              key={tier.id}
              type="button"
              disabled={disabled}
              onClick={() => setBillingTier(tier.id)}
              className={`rounded-xl border px-4 py-3 text-left transition ${
                selected
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-gray-200 bg-white/70 hover:border-primary/30"
              } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <p className="text-sm font-semibold text-text-main">{tier.label}</p>
              <p className="mt-1 text-xs text-text-secondary">
                {tier.includedCredits} кредитов на баланс
              </p>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={status === "loading" || disabled}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {status === "loading" ? "Создаем..." : "Оплатить выбранный тариф"}
        </button>
      </div>
      {notice && <p className="text-xs text-amber-700">{notice}</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </form>
  );
}
