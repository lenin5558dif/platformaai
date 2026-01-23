-- CreateEnum
CREATE TYPE "ChatSource" AS ENUM ('WEB', 'TELEGRAM');

-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "source" "ChatSource" NOT NULL DEFAULT 'WEB';
