-- CreateEnum
CREATE TYPE "PromptVisibility" AS ENUM ('PRIVATE', 'ORG', 'GLOBAL');

-- AlterTable
ALTER TABLE "Prompt" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "visibility" "PromptVisibility" NOT NULL DEFAULT 'ORG';
