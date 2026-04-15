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

  async function handleClick() {
    if (disabled || status === "loading") {
      return;
    }

    setStatus("loading");

    try {
      const response = await fetch("/api/payments/stripe/subscription/checkout", {
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
    } finally {
      setStatus("idle");
    }
  }

  return (
    <button
      type="button"
      className={className}
      disabled={disabled || status === "loading"}
      onClick={handleClick}
    >
      {status === "loading" ? "Создаем..." : label}
    </button>
  );
}
