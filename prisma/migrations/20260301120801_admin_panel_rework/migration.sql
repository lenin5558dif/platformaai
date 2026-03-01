-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('OPENROUTER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_PASSWORD_RESET_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_PASSWORD_RESET_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'PLATFORM_SYSTEM_PROMPT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'PLATFORM_MODEL_TOGGLED';
ALTER TYPE "AuditAction" ADD VALUE 'ORG_PROVIDER_CREDENTIAL_UPDATED';

-- CreateTable
CREATE TABLE "PlatformConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "globalSystemPrompt" TEXT,
    "disabledModelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgProviderCredential" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" "ProviderType" NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "secretFingerprint" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminPasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedById" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminPasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformConfig_updatedById_idx" ON "PlatformConfig"("updatedById");

-- CreateIndex
CREATE INDEX "OrgProviderCredential_orgId_idx" ON "OrgProviderCredential"("orgId");

-- CreateIndex
CREATE INDEX "OrgProviderCredential_provider_idx" ON "OrgProviderCredential"("provider");

-- CreateIndex
CREATE INDEX "OrgProviderCredential_updatedById_idx" ON "OrgProviderCredential"("updatedById");

-- CreateIndex
CREATE UNIQUE INDEX "OrgProviderCredential_orgId_provider_key" ON "OrgProviderCredential"("orgId", "provider");

-- CreateIndex
CREATE INDEX "AdminPasswordResetToken_userId_idx" ON "AdminPasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "AdminPasswordResetToken_requestedById_idx" ON "AdminPasswordResetToken"("requestedById");

-- CreateIndex
CREATE INDEX "AdminPasswordResetToken_tokenPrefix_idx" ON "AdminPasswordResetToken"("tokenPrefix");

-- CreateIndex
CREATE INDEX "AdminPasswordResetToken_expiresAt_idx" ON "AdminPasswordResetToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "PlatformConfig" ADD CONSTRAINT "PlatformConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgProviderCredential" ADD CONSTRAINT "OrgProviderCredential_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgProviderCredential" ADD CONSTRAINT "OrgProviderCredential_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPasswordResetToken" ADD CONSTRAINT "AdminPasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPasswordResetToken" ADD CONSTRAINT "AdminPasswordResetToken_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
