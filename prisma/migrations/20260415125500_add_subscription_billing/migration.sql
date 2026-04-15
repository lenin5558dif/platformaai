ALTER TYPE "TransactionType" ADD VALUE 'SUBSCRIPTION_PURCHASE';
ALTER TYPE "TransactionType" ADD VALUE 'SUBSCRIPTION_RENEWAL';

CREATE TYPE "SubscriptionStatus" AS ENUM (
  'ACTIVE',
  'CANCELED',
  'PAST_DUE',
  'INCOMPLETE',
  'TRIALING'
);

CREATE TABLE "BillingPlan" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "monthlyPriceUsd" DECIMAL(12, 2) NOT NULL,
  "includedCreditsPerMonth" DECIMAL(12, 2) NOT NULL,
  "stripePriceId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BillingPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "currentPeriodStart" TIMESTAMP(3) NOT NULL,
  "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
  "includedCredits" DECIMAL(12, 2) NOT NULL,
  "includedCreditsUsed" DECIMAL(12, 2) NOT NULL DEFAULT 0.0,
  "stripeCustomerId" TEXT,
  "stripeSubscriptionId" TEXT,
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingPlan_code_key" ON "BillingPlan"("code");
CREATE UNIQUE INDEX "BillingPlan_stripePriceId_key" ON "BillingPlan"("stripePriceId");
CREATE UNIQUE INDEX "UserSubscription_userId_key" ON "UserSubscription"("userId");
CREATE UNIQUE INDEX "UserSubscription_stripeSubscriptionId_key" ON "UserSubscription"("stripeSubscriptionId");
CREATE INDEX "UserSubscription_planId_idx" ON "UserSubscription"("planId");
CREATE INDEX "UserSubscription_status_idx" ON "UserSubscription"("status");
CREATE INDEX "UserSubscription_currentPeriodEnd_idx" ON "UserSubscription"("currentPeriodEnd");

ALTER TABLE "UserSubscription"
ADD CONSTRAINT "UserSubscription_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserSubscription"
ADD CONSTRAINT "UserSubscription_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "BillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
