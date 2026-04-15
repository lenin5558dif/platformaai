import { hasRealConfiguredValue } from "@/lib/config-values";

export type PaymentProvider = "yookassa" | "stripe";

function isEnabled(value: string | undefined) {
  return value === "1";
}

export function getPaymentProvider(
  env: Record<string, string | undefined> = process.env
): PaymentProvider | null {
  const yooKassaConfigured =
    hasRealConfiguredValue(env.YOOKASSA_SHOP_ID) &&
    hasRealConfiguredValue(env.YOOKASSA_SECRET_KEY);
  const stripeConfigured =
    hasRealConfiguredValue(env.STRIPE_SECRET_KEY) &&
    hasRealConfiguredValue(env.STRIPE_WEBHOOK_SECRET);
  const requestedProvider = env.PAYMENTS_PROVIDER?.trim().toLowerCase();
  const yooKassaEnabled =
    isEnabled(env.YOOKASSA_CHECKOUT_ENABLED) || requestedProvider === "yookassa";

  if (yooKassaConfigured && yooKassaEnabled) {
    return "yookassa";
  }

  if (stripeConfigured && requestedProvider !== "yookassa") {
    return "stripe";
  }

  return null;
}
