-- Mahngebühren, Verzugszinsen und Verzugspauschale (optional, Standard aus)
-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "baseInterestRate" DECIMAL(5,2),
ADD COLUMN     "dunningFee1" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN     "dunningFee2" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN     "dunningFee3" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN     "dunningInterest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dunningLumpSum" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "isBusiness" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "DunningNotice" ADD COLUMN     "fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "interest" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "interestFrom" DATE,
ADD COLUMN     "interestRate" DECIMAL(5,2),
ADD COLUMN     "lumpSum" DECIMAL(10,2) NOT NULL DEFAULT 0;

