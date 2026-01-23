-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('AI_REQUEST', 'AI_ERROR', 'BILLING_ERROR', 'STT_ERROR', 'AUTH_ERROR');

-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "message" TEXT,
    "userId" TEXT,
    "chatId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventLog_type_idx" ON "EventLog"("type");

-- CreateIndex
CREATE INDEX "EventLog_userId_idx" ON "EventLog"("userId");

-- CreateIndex
CREATE INDEX "EventLog_chatId_idx" ON "EventLog"("chatId");
