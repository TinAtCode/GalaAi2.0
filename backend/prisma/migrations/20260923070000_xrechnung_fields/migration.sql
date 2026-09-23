-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "bic" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "iban" TEXT,
ADD COLUMN     "paymentTermDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "buyerReference" TEXT;

