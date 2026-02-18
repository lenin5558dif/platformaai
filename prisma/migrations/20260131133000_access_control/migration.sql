-- CreateEnum
CREATE TYPE "AccessChannel" AS ENUM (
  'WEB',
  'TELEGRAM'
);

-- CreateEnum
CREATE TYPE "QuotaScope" AS ENUM (
  'USER',
  'COST_CENTER',
  'ORG'
);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "sessionInvalidatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "channel" "AccessChannel";
ALTER TABLE "AuditLog" ADD COLUMN "correlationId" TEXT;

-- CreateTable
CREATE TABLE "OrgMembership" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "defaultCostCenterId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrgMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgRole" (
  "id" TEXT NOT NULL,
  "orgId" TEXT,
  "name" TEXT NOT NULL,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrgRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgPermission" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrgPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgRolePermission" (
  "id" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "permissionId" TEXT NOT NULL,

  CONSTRAINT "OrgRolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserChannel" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "channel" "AccessChannel" NOT NULL,
  "externalId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgInvite" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "defaultCostCenterId" TEXT,
  "tokenHash" TEXT NOT NULL,
  "tokenPrefix" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrgInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DlpPolicy" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "rules" JSONB NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DlpPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelPolicy" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "rules" JSONB NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ModelPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotaBucket" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "scope" "QuotaScope" NOT NULL,
  "subjectId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "limit" DECIMAL(12, 2) NOT NULL,
  "spent" DECIMAL(12, 2) NOT NULL DEFAULT 0.0,
  "reserved" DECIMAL(12, 2) NOT NULL DEFAULT 0.0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "QuotaBucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotaReservation" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "scope" "QuotaScope" NOT NULL,
  "subjectId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "amount" DECIMAL(12, 2) NOT NULL,
  "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consumedAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),

  CONSTRAINT "QuotaReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgMembership_orgId_userId_key" ON "OrgMembership"("orgId", "userId");

-- CreateIndex
CREATE INDEX "OrgMembership_orgId_idx" ON "OrgMembership"("orgId");

-- CreateIndex
CREATE INDEX "OrgMembership_userId_idx" ON "OrgMembership"("userId");

-- CreateIndex
CREATE INDEX "OrgMembership_roleId_idx" ON "OrgMembership"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgRole_orgId_name_key" ON "OrgRole"("orgId", "name");

-- CreateIndex
CREATE INDEX "OrgRole_orgId_idx" ON "OrgRole"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgPermission_key_key" ON "OrgPermission"("key");

-- CreateIndex
CREATE UNIQUE INDEX "OrgRolePermission_roleId_permissionId_key" ON "OrgRolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE INDEX "OrgRolePermission_roleId_idx" ON "OrgRolePermission"("roleId");

-- CreateIndex
CREATE INDEX "OrgRolePermission_permissionId_idx" ON "OrgRolePermission"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "UserChannel_channel_externalId_key" ON "UserChannel"("channel", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "UserChannel_userId_channel_key" ON "UserChannel"("userId", "channel");

-- CreateIndex
CREATE INDEX "UserChannel_userId_idx" ON "UserChannel"("userId");

-- CreateIndex
CREATE INDEX "OrgInvite_orgId_idx" ON "OrgInvite"("orgId");

-- CreateIndex
CREATE INDEX "OrgInvite_email_idx" ON "OrgInvite"("email");

-- CreateIndex
CREATE INDEX "OrgInvite_tokenPrefix_idx" ON "OrgInvite"("tokenPrefix");

-- CreateIndex
CREATE UNIQUE INDEX "OrgInvite_orgId_email_usedAt_key" ON "OrgInvite"("orgId", "email", "usedAt");

-- CreateIndex
CREATE INDEX "DlpPolicy_orgId_idx" ON "DlpPolicy"("orgId");

-- CreateIndex
CREATE INDEX "ModelPolicy_orgId_idx" ON "ModelPolicy"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "QuotaBucket_scope_subjectId_periodStart_periodEnd_key" ON "QuotaBucket"("scope", "subjectId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "QuotaBucket_orgId_idx" ON "QuotaBucket"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "QuotaReservation_requestId_key" ON "QuotaReservation"("requestId");

-- CreateIndex
CREATE INDEX "QuotaReservation_orgId_idx" ON "QuotaReservation"("orgId");

-- CreateIndex
CREATE INDEX "QuotaReservation_scope_subjectId_idx" ON "QuotaReservation"("scope", "subjectId");

-- CreateIndex
CREATE INDEX "AuditLog_channel_idx" ON "AuditLog"("channel");

-- AddForeignKey
ALTER TABLE "OrgMembership" ADD CONSTRAINT "OrgMembership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMembership" ADD CONSTRAINT "OrgMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMembership" ADD CONSTRAINT "OrgMembership_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "OrgRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMembership" ADD CONSTRAINT "OrgMembership_defaultCostCenterId_fkey" FOREIGN KEY ("defaultCostCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgRole" ADD CONSTRAINT "OrgRole_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgRolePermission" ADD CONSTRAINT "OrgRolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "OrgRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgRolePermission" ADD CONSTRAINT "OrgRolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "OrgPermission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserChannel" ADD CONSTRAINT "UserChannel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgInvite" ADD CONSTRAINT "OrgInvite_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgInvite" ADD CONSTRAINT "OrgInvite_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "OrgRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgInvite" ADD CONSTRAINT "OrgInvite_defaultCostCenterId_fkey" FOREIGN KEY ("defaultCostCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgInvite" ADD CONSTRAINT "OrgInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DlpPolicy" ADD CONSTRAINT "DlpPolicy_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DlpPolicy" ADD CONSTRAINT "DlpPolicy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DlpPolicy" ADD CONSTRAINT "DlpPolicy_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelPolicy" ADD CONSTRAINT "ModelPolicy_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelPolicy" ADD CONSTRAINT "ModelPolicy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelPolicy" ADD CONSTRAINT "ModelPolicy_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotaBucket" ADD CONSTRAINT "QuotaBucket_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotaReservation" ADD CONSTRAINT "QuotaReservation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
