-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "externalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_externalId_key" ON "Transaction"("externalId");
