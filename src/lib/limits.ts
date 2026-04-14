export function isSameUtcDay(a: Date, b: Date) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export function isSameUtcMonth(a: Date, b: Date) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth()
  );
}

export function applyLimitResets(params: {
  dailySpent: number;
  monthlySpent: number;
  dailyResetAt: Date;
  monthlyResetAt: Date;
}) {
  const now = new Date();
  let dailySpent = params.dailySpent;
  let monthlySpent = params.monthlySpent;
  let dailyResetAt = params.dailyResetAt;
  let monthlyResetAt = params.monthlyResetAt;

  if (!isSameUtcDay(dailyResetAt, now)) {
    dailySpent = 0;
    dailyResetAt = now;
  }

  if (!isSameUtcMonth(monthlyResetAt, now)) {
    monthlySpent = 0;
    monthlyResetAt = now;
  }

  return { dailySpent, monthlySpent, dailyResetAt, monthlyResetAt };
}
