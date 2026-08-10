-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "IssuerApplication" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "contactEmail" TEXT NOT NULL,
    "website" TEXT,
    "description" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "admitTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssuerApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IssuerApplication_walletAddress_key" ON "IssuerApplication"("walletAddress");

-- CreateIndex
CREATE INDEX "IssuerApplication_status_createdAt_idx" ON "IssuerApplication"("status", "createdAt");
