-- CreateEnum
CREATE TYPE "ZoyaRole" AS ENUM ('USER', 'ZOYA');

-- CreateTable
CREATE TABLE "ZoyaMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "walletAddress" TEXT,
    "role" "ZoyaRole" NOT NULL,
    "content" TEXT NOT NULL,
    "sources" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZoyaMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ZoyaMessage_conversationId_createdAt_idx" ON "ZoyaMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ZoyaMessage_walletAddress_createdAt_idx" ON "ZoyaMessage"("walletAddress", "createdAt");
