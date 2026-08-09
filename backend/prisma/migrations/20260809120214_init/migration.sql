-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('PENDING', 'NEEDS_REVIEW', 'INVALID', 'VALIDATED', 'MINTED', 'REJECTED');

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "byteSize" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Extraction" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "terms" JSONB NOT NULL,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "consistent" BOOLEAN NOT NULL DEFAULT false,
    "unreviewedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,

    CONSTRAINT "Extraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "noteAddress" TEXT NOT NULL,
    "vaultAddress" TEXT NOT NULL,
    "issuerAddress" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "mintedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Document_contentHash_key" ON "Document"("contentHash");

-- CreateIndex
CREATE INDEX "Document_createdAt_idx" ON "Document"("createdAt");

-- CreateIndex
CREATE INDEX "Extraction_documentId_createdAt_idx" ON "Extraction"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "Extraction_status_idx" ON "Extraction"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Note_extractionId_key" ON "Note"("extractionId");

-- CreateIndex
CREATE UNIQUE INDEX "Note_txHash_key" ON "Note"("txHash");

-- CreateIndex
CREATE INDEX "Note_issuerAddress_idx" ON "Note"("issuerAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Note_chainId_noteAddress_key" ON "Note"("chainId", "noteAddress");

-- AddForeignKey
ALTER TABLE "Extraction" ADD CONSTRAINT "Extraction_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "Extraction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
