-- Kontobewegungen in beide Richtungen: bisher nur Gutschriften
CREATE TYPE "BankDirection" AS ENUM ('credit', 'debit');
ALTER TABLE "BankTransaction" ADD COLUMN "direction" "BankDirection" NOT NULL DEFAULT 'credit';
-- Rückbuchungen (RvslInd) kennzeichnen; bisher eingelesene Umsätze gelten als normale Umsätze
ALTER TABLE "BankTransaction" ADD COLUMN "reversal" BOOLEAN NOT NULL DEFAULT false;
-- Gegenpartei statt Zahler: bei Abbuchungen steht hier der Empfänger
ALTER TABLE "BankTransaction" RENAME COLUMN "debtorName" TO "counterpartyName";
ALTER TABLE "BankTransaction" RENAME COLUMN "debtorIban" TO "counterpartyIban";
CREATE INDEX "BankTransaction_companyId_bookingDate_idx" ON "BankTransaction"("companyId", "bookingDate");

-- Kontostände (Schlusssaldo je Konto und Tag)
CREATE TABLE "BankBalance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountIban" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankBalance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BankBalance_companyId_accountIban_date_key" ON "BankBalance"("companyId", "accountIban", "date");
ALTER TABLE "BankBalance" ADD CONSTRAINT "BankBalance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "BankBalance"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId');

-- Neues Recht "finance.read" (Finanzbereich). Rollen mit
-- Systemeinstellungen (Geschäftsführung/Administratoren) erhalten es.
INSERT INTO "Permission" ("id", "key", "label")
VALUES (gen_random_uuid()::text, 'finance.read', 'finance.read')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT rp."roleId", fin.id
FROM "RolePermission" rp
JOIN "Permission" settings ON settings.id = rp."permissionId" AND settings.key = 'system.settings.write'
CROSS JOIN (SELECT id FROM "Permission" WHERE key = 'finance.read') fin
ON CONFLICT DO NOTHING;

-- Rolle "Buchhaltung" für jede Firma: Finanzen, Rechnungen und Zahlungen,
-- DATEV-Export, Kunden lesen, Dokumente sehen und hochladen – keine Einkaufspreise, keine
-- Nutzer- oder Systemverwaltung
INSERT INTO "Role" ("id", "companyId", "name", "isSystem")
SELECT gen_random_uuid()::text, c.id, 'Buchhaltung', true
FROM "Company" c
ON CONFLICT ("companyId", "name") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "Role" r
JOIN "Permission" p ON p.key IN ('finance.read', 'invoice.create', 'data.export', 'customer.read', 'document.read', 'price.sale.read')
WHERE r.name = 'Buchhaltung' AND r."isSystem" = true
ON CONFLICT DO NOTHING;
