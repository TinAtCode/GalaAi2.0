-- CreateEnum
CREATE TYPE "OcrJobStatus" AS ENUM ('queued', 'running', 'done', 'failed');

-- CreateTable
CREATE TABLE "OcrJob" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "fileName" TEXT NOT NULL,
    "status" "OcrJobStatus" NOT NULL DEFAULT 'queued',
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "OcrJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OcrJob_companyId_createdAt_idx" ON "OcrJob"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "OcrJob" ADD CONSTRAINT "OcrJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

