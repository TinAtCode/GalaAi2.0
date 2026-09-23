-- CreateEnum
CREATE TYPE "QuantityRounding" AS ENUM ('half_up', 'up', 'down');

-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "quantityDecimals" INTEGER,
ADD COLUMN     "quantityRounding" "QuantityRounding",
ADD COLUMN     "quantityStep" DECIMAL(10,3);

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "quantityDecimals" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "quantityRounding" "QuantityRounding" NOT NULL DEFAULT 'half_up';

-- AlterTable
ALTER TABLE "InvoiceLineItem" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,3);

-- AlterTable
ALTER TABLE "ProjectMaterialUsage" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,3);

-- AlterTable
ALTER TABLE "QuoteLineItem" ADD COLUMN     "quantityExact" DECIMAL(14,4),
ADD COLUMN     "roundingDecimals" INTEGER,
ADD COLUMN     "roundingMode" "QuantityRounding",
ADD COLUMN     "roundingSource" TEXT,
ADD COLUMN     "roundingStep" DECIMAL(10,3),
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,3);

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "quantityDecimals" INTEGER,
ADD COLUMN     "quantityRounding" "QuantityRounding",
ADD COLUMN     "quantityStep" DECIMAL(10,3);

-- CreateTable
CREATE TABLE "UnitSetting" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "decimals" INTEGER,
    "rounding" "QuantityRounding",
    "step" DECIMAL(10,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnitSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnitSetting_companyId_code_key" ON "UnitSetting"("companyId", "code");

-- AddForeignKey
ALTER TABLE "UnitSetting" ADD CONSTRAINT "UnitSetting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Mandantentrennung (siehe tenant_guard)
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "UnitSetting"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId');

-- Bestehende Positionen: die gespeicherte Menge ist die genaue Menge. Damit
-- ein alter Entwurf beim nächsten Speichern nicht nach den neuen Vorgaben neu
-- gerundet wird (2,5 Stk -> 3 Stk), bekommt jede Position eine eigene Regel,
-- die ihre Menge unverändert lässt (3 Nachkommastellen, kaufmännisch).
UPDATE "QuoteLineItem"
SET "quantityExact" = "quantity",
    "roundingDecimals" = 3,
    "roundingMode" = 'half_up',
    "roundingSource" = 'position'
WHERE "quantityExact" IS NULL;

-- Stammdaten (Leistungen, Artikel) auf die Katalog-Schreibweise bringen, z.B.
-- "qm" -> "m²". Angebote und Rechnungen bleiben unverändert (Snapshot).
UPDATE "Service" SET unit = 'm' WHERE lower(trim(unit)) IN ('lfdm', 'lfm', 'm', 'meter') AND unit <> 'm';
UPDATE "Article" SET unit = 'm' WHERE lower(trim(unit)) IN ('lfdm', 'lfm', 'm', 'meter') AND unit <> 'm';
UPDATE "Service" SET unit = 'cm²' WHERE lower(trim(unit)) IN ('cm2', 'cm²', 'qcm') AND unit <> 'cm²';
UPDATE "Article" SET unit = 'cm²' WHERE lower(trim(unit)) IN ('cm2', 'cm²', 'qcm') AND unit <> 'cm²';
UPDATE "Service" SET unit = 'm²' WHERE lower(trim(unit)) IN ('m2', 'm²', 'qm') AND unit <> 'm²';
UPDATE "Article" SET unit = 'm²' WHERE lower(trim(unit)) IN ('m2', 'm²', 'qm') AND unit <> 'm²';
UPDATE "Service" SET unit = 'l' WHERE lower(trim(unit)) IN ('l', 'liter', 'ltr') AND unit <> 'l';
UPDATE "Article" SET unit = 'l' WHERE lower(trim(unit)) IN ('l', 'liter', 'ltr') AND unit <> 'l';
UPDATE "Service" SET unit = 'm³' WHERE lower(trim(unit)) IN ('cbm', 'm3', 'm³') AND unit <> 'm³';
UPDATE "Article" SET unit = 'm³' WHERE lower(trim(unit)) IN ('cbm', 'm3', 'm³') AND unit <> 'm³';
UPDATE "Service" SET unit = 't' WHERE lower(trim(unit)) IN ('t', 'to') AND unit <> 't';
UPDATE "Article" SET unit = 't' WHERE lower(trim(unit)) IN ('t', 'to') AND unit <> 't';
UPDATE "Service" SET unit = 'Stk' WHERE lower(trim(unit)) IN ('st', 'stck', 'stk', 'stück') AND unit <> 'Stk';
UPDATE "Article" SET unit = 'Stk' WHERE lower(trim(unit)) IN ('st', 'stck', 'stk', 'stück') AND unit <> 'Stk';
UPDATE "Service" SET unit = 'Sack' WHERE lower(trim(unit)) IN ('sa', 'sack') AND unit <> 'Sack';
UPDATE "Article" SET unit = 'Sack' WHERE lower(trim(unit)) IN ('sa', 'sack') AND unit <> 'Sack';
UPDATE "Service" SET unit = 'Pal' WHERE lower(trim(unit)) IN ('pal', 'palette') AND unit <> 'Pal';
UPDATE "Article" SET unit = 'Pal' WHERE lower(trim(unit)) IN ('pal', 'palette') AND unit <> 'Pal';
UPDATE "Service" SET unit = 'h' WHERE lower(trim(unit)) IN ('h', 'std', 'stunde', 'stunden') AND unit <> 'h';
UPDATE "Article" SET unit = 'h' WHERE lower(trim(unit)) IN ('h', 'std', 'stunde', 'stunden') AND unit <> 'h';
UPDATE "Service" SET unit = 'psch' WHERE lower(trim(unit)) IN ('pau', 'pausch', 'pauschal', 'psch') AND unit <> 'psch';
UPDATE "Article" SET unit = 'psch' WHERE lower(trim(unit)) IN ('pau', 'pausch', 'pauschal', 'psch') AND unit <> 'psch';
UPDATE "Service" SET unit = 'mm' WHERE lower(trim(unit)) IN ('mm') AND unit <> 'mm';
UPDATE "Article" SET unit = 'mm' WHERE lower(trim(unit)) IN ('mm') AND unit <> 'mm';
UPDATE "Service" SET unit = 'cm' WHERE lower(trim(unit)) IN ('cm') AND unit <> 'cm';
UPDATE "Article" SET unit = 'cm' WHERE lower(trim(unit)) IN ('cm') AND unit <> 'cm';
UPDATE "Service" SET unit = 'km' WHERE lower(trim(unit)) IN ('km') AND unit <> 'km';
UPDATE "Article" SET unit = 'km' WHERE lower(trim(unit)) IN ('km') AND unit <> 'km';
UPDATE "Service" SET unit = 'ha' WHERE lower(trim(unit)) IN ('ha') AND unit <> 'ha';
UPDATE "Article" SET unit = 'ha' WHERE lower(trim(unit)) IN ('ha') AND unit <> 'ha';
UPDATE "Service" SET unit = 'g' WHERE lower(trim(unit)) IN ('g') AND unit <> 'g';
UPDATE "Article" SET unit = 'g' WHERE lower(trim(unit)) IN ('g') AND unit <> 'g';
UPDATE "Service" SET unit = 'kg' WHERE lower(trim(unit)) IN ('kg') AND unit <> 'kg';
UPDATE "Article" SET unit = 'kg' WHERE lower(trim(unit)) IN ('kg') AND unit <> 'kg';
UPDATE "Service" SET unit = 'min' WHERE lower(trim(unit)) IN ('min') AND unit <> 'min';
UPDATE "Article" SET unit = 'min' WHERE lower(trim(unit)) IN ('min') AND unit <> 'min';
