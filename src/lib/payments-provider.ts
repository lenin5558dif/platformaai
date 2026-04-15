import { hasRealConfiguredValue } from "@/lib/config-values";

export type PaymentProvider = "yookassa" | "stripe";

export function getPaymentProvider(
  env: Record<string, string | undefined> = process.env
): PaymentProvider | null {
  const yooKassaConfigured =
    hasRealConfiguredValue(env.YOOKASSA_SHOP_ID) &&
    hasRealConfiguredValue(env.YOOKASSA_SECRET_KEY);

  if (yooKassaConfigured) {
    return "yookassa";
  }

  const stripeConfigured =
    hasRealConfiguredValue(env.STRIPE_SECRET_KEY) &&
    hasRealConfiguredValue(env.STRIPE_WEBHOOK_SECRET);

  if (stripeConfigured) {
    return "stripe";
  }

  return null;
}
