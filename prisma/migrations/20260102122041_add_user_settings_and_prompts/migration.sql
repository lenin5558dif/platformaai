-- AlterTable
ALTER TABLE "User" ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "Prompt" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "orgId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prompt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Prompt_orgId_idx" ON "Prompt"("orgId");

-- CreateIndex
CREATE INDEX "Prompt_createdById_idx" ON "Prompt"("createdById");

-- AddForeignKey
ALTER TABLE "Prompt" ADD CONSTRAINT "Prompt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
