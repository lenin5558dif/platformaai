type SubscriptionSnapshot = {
  status?: string | null;
  currentPeriodEnd?: Date | string | null;
  includedCredits?: number | { toString(): string } | null;
  includedCreditsUsed?: number | { toString(): string } | null;
} | null | undefined;

function decimalToNumber(value: number | { toString(): string } | null | undefined) {
  if (typeof value === "number") return value;
  if (!value) return 0;
  return Number(value.toString());
}

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isSubscriptionActive(
  subscription: SubscriptionSnapshot,
  now: Date = new Date()
) {
  if (!subscription) return false;
  if (!["ACTIVE", "TRIALING"].includes(subscription.status ?? "")) return false;

  const periodEnd = toDate(subscription.currentPeriodEnd);
  if (!periodEnd) return false;

  return periodEnd.getTime() > now.getTime();
}

export function getIncludedCreditsRemaining(
  subscription: SubscriptionSnapshot,
  now: Date = new Date()
) {
  if (!isSubscriptionActive(subscription, now)) return 0;

  const includedCredits = decimalToNumber(subscription?.includedCredits);
  const includedCreditsUsed = decimalToNumber(subscription?.includedCreditsUsed);

  return Math.max(0, includedCredits - includedCreditsUsed);
}

export function getSpendableCredits(params: {
  balance?: number | { toString(): string } | null;
  subscription?: SubscriptionSnapshot;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const balance = decimalToNumber(params.balance);
  const includedRemaining = getIncludedCreditsRemaining(params.subscription, now);

  return {
    balance,
    includedRemaining,
    total: balance + includedRemaining,
  };
}
