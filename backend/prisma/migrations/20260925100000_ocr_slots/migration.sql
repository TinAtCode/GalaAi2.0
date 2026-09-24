-- AlterTable
ALTER TABLE "OcrJob" ADD COLUMN     "heartbeatAt" TIMESTAMP(3),
ADD COLUMN     "worker" TEXT;

-- CreateTable
CREATE TABLE "OcrSlot" (
    "id" INTEGER NOT NULL,
    "holder" TEXT,
    "leasedUntil" TIMESTAMP(3),

    CONSTRAINT "OcrSlot_pkey" PRIMARY KEY ("id")
);

