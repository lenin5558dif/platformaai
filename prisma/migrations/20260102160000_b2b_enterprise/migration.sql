-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM (
  'ORG_UPDATED',
  'USER_INVITED',
  'USER_UPDATED',
  'USER_DISABLED',
  'COST_CENTER_CREATED',
  'COST_CENTER_UPDATED',
  'COST_CENTER_DELETED',
  'COST_CENTER_ASSIGNED',
  'DLP_POLICY_UPDATED',
  'MODEL_POLICY_UPDATED',
  'POLICY_BLOCKED',
  'SCIM_TOKEN_CREATED',
  'SCIM_TOKEN_REVOKED',
  'SCIM_USER_SYNC',
  'SCIM_GROUP_SYNC',
  'SSO_DOMAIN_UPDATED'
);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "costCenterId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "costCenterId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "costCenterId" TEXT;

-- CreateTable
CREATE TABLE "CostCenter" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScimToken" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "tokenPrefix" TEXT NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ScimToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgDomain" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "ssoOnly" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrgDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "orgId" TEXT,
  "actorId" TEXT,
  "action" "AuditAction" NOT NULL,
  "targetType" TEXT,
  "targetId" TEXT,
  "ip" TEXT,
  "userAgent" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostCenter_orgId_idx" ON "CostCenter"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "CostCenter_orgId_name_key" ON "CostCenter"("orgId", "name");

-- CreateIndex
CREATE INDEX "ScimToken_orgId_idx" ON "ScimToken"("orgId");

-- CreateIndex
CREATE INDEX "ScimToken_tokenPrefix_idx" ON "ScimToken"("tokenPrefix");

-- CreateIndex
CREATE UNIQUE INDEX "OrgDomain_domain_key" ON "OrgDomain"("domain");

-- CreateIndex
CREATE INDEX "OrgDomain_orgId_idx" ON "OrgDomain"("orgId");

-- CreateIndex
CREATE INDEX "AuditLog_orgId_idx" ON "AuditLog"("orgId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "Message_costCenterId_idx" ON "Message"("costCenterId");

-- CreateIndex
CREATE INDEX "Transaction_costCenterId_idx" ON "Transaction"("costCenterId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimToken" ADD CONSTRAINT "ScimToken_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgDomain" ADD CONSTRAINT "OrgDomain_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
