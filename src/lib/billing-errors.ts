type BillingErrorResponse = {
  status: number;
  error: string;
};

export const mapBillingError = (message: string): BillingErrorResponse => {
  if (message === "INSUFFICIENT_BALANCE") {
    return { status: 402, error: "Insufficient balance" };
  }
  if (message === "DAILY_LIMIT_EXCEEDED") {
    return { status: 409, error: "Daily limit exceeded" };
  }
  if (message === "MONTHLY_LIMIT_EXCEEDED") {
    return { status: 409, error: "Monthly limit exceeded" };
  }
  if (message === "ORG_BUDGET_EXCEEDED") {
    return { status: 409, error: "Organization budget exceeded" };
  }
  if (message === "COST_CENTER_BUDGET_EXCEEDED") {
    return { status: 409, error: "Cost center budget exceeded" };
  }
  if (message === "USER_NOT_FOUND") {
    return { status: 404, error: "User not found" };
  }
  return { status: 500, error: "Billing error" };
};
