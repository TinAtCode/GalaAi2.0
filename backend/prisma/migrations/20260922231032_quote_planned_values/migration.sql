-- AlterTable
ALTER TABLE "QuoteLineItem" ADD COLUMN     "plannedLaborMinutesPerUnit" INTEGER,
ADD COLUMN     "plannedMaterialCostPerUnit" DECIMAL(14,6);

