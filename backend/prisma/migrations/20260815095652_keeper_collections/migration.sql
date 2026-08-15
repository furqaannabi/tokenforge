-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "noteAddress" TEXT NOT NULL,
    "vaultAddress" TEXT NOT NULL,
    "extractionId" TEXT,
    "outcome" TEXT NOT NULL,
    "txHash" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Collection_txHash_key" ON "Collection"("txHash");

-- CreateIndex
CREATE INDEX "Collection_vaultAddress_idx" ON "Collection"("vaultAddress");
