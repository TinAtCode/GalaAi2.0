-- CreateEnum
CREATE TYPE "CategoryRuleField" AS ENUM ('any', 'counterparty', 'remittance', 'iban');

-- CreateEnum
CREATE TYPE "CategorySource" AS ENUM ('rule', 'learned', 'manual');

-- CreateEnum
CREATE TYPE "RecurringInterval" AS ENUM ('monthly', 'quarterly', 'halfyearly', 'yearly');

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "categorySource" "CategorySource",
ADD COLUMN     "categorizedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "field" "CategoryRuleField" NOT NULL DEFAULT 'any',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CategoryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringPayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "counterpartyName" TEXT,
    "counterpartyIban" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "interval" "RecurringInterval" NOT NULL,
    "nextDue" DATE NOT NULL,
    "endDate" DATE,
    "categoryId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_companyId_name_key" ON "ExpenseCategory"("companyId", "name");

-- CreateIndex
CREATE INDEX "CategoryRule_companyId_idx" ON "CategoryRule"("companyId");

-- CreateIndex
CREATE INDEX "RecurringPayment_companyId_idx" ON "RecurringPayment"("companyId");

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringPayment" ADD CONSTRAINT "RecurringPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringPayment" ADD CONSTRAINT "RecurringPayment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Mandantentrennung (siehe tenant_guard)
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "ExpenseCategory"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "CategoryRule"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'categoryId:ExpenseCategory');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "RecurringPayment"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'categoryId:ExpenseCategory');
DROP TRIGGER tenant_guard ON "BankTransaction";
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "BankTransaction"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'categoryId:ExpenseCategory');

-- Startwerte für bestehende Firmen (wie DEFAULT_CATEGORIES/DEFAULT_RULES in
-- src/finance/categorize.ts): Kategorien für den GaLaBau und Stichwort-Regeln
INSERT INTO "ExpenseCategory" ("id", "companyId", "name", "sortOrder")
SELECT gen_random_uuid()::text, c.id, v.name, v.sort FROM "Company" c
CROSS JOIN (VALUES ('Material', 0), ('Fahrzeuge', 1), ('Maschinen', 2), ('Miete', 3), ('Personal', 4), ('Versicherungen', 5), ('Büro', 6), ('Steuern', 7), ('Sonstiges', 8)) AS v(name, sort)
ON CONFLICT ("companyId", "name") DO NOTHING;

INSERT INTO "CategoryRule" ("id", "companyId", "categoryId", "pattern", "field", "createdAt")
SELECT gen_random_uuid()::text, ec."companyId", ec.id, r.pattern, 'any', TIMESTAMP 'epoch'
FROM "ExpenseCategory" ec
JOIN (VALUES ('tankstelle', 'Fahrzeuge'), ('aral', 'Fahrzeuge'), ('shell', 'Fahrzeuge'), ('esso', 'Fahrzeuge'), ('totalenergies', 'Fahrzeuge'), ('kfz-steuer', 'Fahrzeuge'), ('baustoff', 'Material'), ('baywa', 'Material'), ('raiffeisen', 'Material'), ('hornbach', 'Material'), ('bauhaus', 'Material'), ('obi ', 'Material'), ('baumschule', 'Material'), ('miete', 'Miete'), ('pacht', 'Miete'), ('lohn', 'Personal'), ('gehalt', 'Personal'), ('krankenkasse', 'Personal'), ('aok', 'Personal'), ('berufsgenossenschaft', 'Personal'), ('versicherung', 'Versicherungen'), ('allianz', 'Versicherungen'), ('telekom', 'Büro'), ('vodafone', 'Büro'), ('finanzamt', 'Steuern'), ('steuerberat', 'Büro')) AS r(pattern, category) ON r.category = ec.name;

-- Startwerte sind angelegt: nicht noch einmal (auch nicht nach dem Löschen)
ALTER TABLE "Company" ADD COLUMN "financeDefaultsAt" TIMESTAMP(3);
UPDATE "Company" SET "financeDefaultsAt" = CURRENT_TIMESTAMP;
