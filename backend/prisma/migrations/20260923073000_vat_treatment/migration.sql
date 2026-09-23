-- CreateEnum
CREATE TYPE "VatTreatment" AS ENUM ('standard', 'small_business', 'reverse_charge');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "smallBusiness" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "vatId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "vatTreatment" "VatTreatment" NOT NULL DEFAULT 'standard';

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "vatTreatment" "VatTreatment" NOT NULL DEFAULT 'standard';

