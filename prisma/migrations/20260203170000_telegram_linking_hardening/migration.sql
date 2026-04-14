-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TELEGRAM_LINKED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TELEGRAM_UNLINKED';

-- AlterTable
ALTER TABLE "TelegramLinkToken" ADD COLUMN "telegramLinkTokenHash" TEXT;

-- CreateIndex
CREATE INDEX "TelegramLinkToken_telegramLinkTokenHash_idx" ON "TelegramLinkToken"("telegramLinkTokenHash");

-- AlterTable
ALTER TABLE "User" ADD COLUMN "globalRevokeCounter" INTEGER NOT NULL DEFAULT 0;
