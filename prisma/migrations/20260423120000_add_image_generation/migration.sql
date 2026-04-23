-- CreateEnum
CREATE TYPE "ImageGenerationStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "ImageGeneration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT,
    "messageId" TEXT,
    "prompt" TEXT NOT NULL,
    "revisedPrompt" TEXT,
    "modelId" TEXT NOT NULL,
    "status" "ImageGenerationStatus" NOT NULL DEFAULT 'PENDING',
    "mimeType" TEXT,
    "storagePath" TEXT,
    "publicUrl" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "aspectRatio" TEXT,
    "imageSize" TEXT,
    "cost" DECIMAL(12,4) NOT NULL DEFAULT 0.0,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "providerRequestId" TEXT,
    "error" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImageGeneration_userId_idx" ON "ImageGeneration"("userId");

-- CreateIndex
CREATE INDEX "ImageGeneration_chatId_idx" ON "ImageGeneration"("chatId");

-- CreateIndex
CREATE INDEX "ImageGeneration_messageId_idx" ON "ImageGeneration"("messageId");

-- CreateIndex
CREATE INDEX "ImageGeneration_status_idx" ON "ImageGeneration"("status");

-- CreateIndex
CREATE INDEX "ImageGeneration_createdAt_idx" ON "ImageGeneration"("createdAt");

-- CreateIndex
CREATE INDEX "ImageGeneration_modelId_idx" ON "ImageGeneration"("modelId");

-- AddForeignKey
ALTER TABLE "ImageGeneration" ADD CONSTRAINT "ImageGeneration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageGeneration" ADD CONSTRAINT "ImageGeneration_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageGeneration" ADD CONSTRAINT "ImageGeneration_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
