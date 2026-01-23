-- Apply after initial migration
ALTER TABLE "User" ADD CONSTRAINT "User_balance_nonnegative" CHECK (balance >= 0);
ALTER TABLE "User" ADD CONSTRAINT "User_daily_spent_nonnegative" CHECK ("dailySpent" >= 0);
ALTER TABLE "User" ADD CONSTRAINT "User_monthly_spent_nonnegative" CHECK ("monthlySpent" >= 0);
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_budget_nonnegative" CHECK (budget >= 0);
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_spent_nonnegative" CHECK (spent >= 0);
