-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "defaultVatRate" DECIMAL(5,2) NOT NULL DEFAULT 19.00;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "number" TEXT,
ADD COLUMN     "totalGross" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "totalVat" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 19.00;

-- CreateTable
CREATE TABLE "NumberSequence" (
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NumberSequence_pkey" PRIMARY KEY ("companyId","kind","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "Quote_companyId_number_key" ON "Quote"("companyId", "number");

-- AddForeignKey
ALTER TABLE "NumberSequence" ADD CONSTRAINT "NumberSequence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

