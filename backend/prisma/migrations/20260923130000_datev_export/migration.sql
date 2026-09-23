-- CreateEnum
CREATE TYPE "DatevChart" AS ENUM ('SKR03', 'SKR04');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "datevChartOfAccounts" "DatevChart" NOT NULL DEFAULT 'SKR03',
ADD COLUMN     "datevClientNumber" INTEGER,
ADD COLUMN     "datevConsultantNumber" INTEGER,
ADD COLUMN     "datevRevenueAccounts" JSONB;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "debtorNumber" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Customer_companyId_debtorNumber_key" ON "Customer"("companyId", "debtorNumber");


-- Bestehende Kunden bekommen fortlaufende Debitorennummern ab 10000
-- (in der Reihenfolge ihrer Anlage); der Zähler steht danach auf der
-- Anzahl der Kunden, neue Kunden machen dort weiter.
UPDATE "Customer" c
SET "debtorNumber" = 9999 + numbered.n
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "companyId" ORDER BY "createdAt", id) AS n
  FROM "Customer"
) numbered
WHERE c.id = numbered.id;

INSERT INTO "NumberSequence" ("companyId", "kind", "year", "lastValue")
SELECT "companyId", 'debtor', 0, COUNT(*)
FROM "Customer"
GROUP BY "companyId"
ON CONFLICT ("companyId", "kind", "year") DO UPDATE SET "lastValue" = EXCLUDED."lastValue";
