"use client";

import { useState } from "react";
import type { BillingPlanId } from "@/lib/plans";

type PlanCheckoutButtonProps = {
  planId: BillingPlanId;
  label: string;
  className: string;
  disabled?: boolean;
};

export default function PlanCheckoutButton({
  planId,
  label,
  className,
  disabled = false,
}: PlanCheckoutButtonProps) {
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (disabled || status === "loading") {
      return;
    }

    setStatus("loading");
    setError(null);

    try {
      const response = await fetch("/api/payments/subscription/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });

      if (response.status === 401) {
        window.location.assign("/login?mode=signin");
        return;
      }

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        url?: string;
      };

      if (response.ok && data.url) {
        window.location.assign(data.url);
        return;
      }
      setError(data.error ?? "Не удалось создать оплату подписки.");
    } finally {
      setStatus("idle");
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className={className}
        disabled={disabled || status === "loading"}
        onClick={handleClick}
      >
        {status === "loading" ? "Создаем..." : label}
      </button>
      {error ? <p className="text-xs text-red-500">{error}</p> : null}
    </div>
  );
}
