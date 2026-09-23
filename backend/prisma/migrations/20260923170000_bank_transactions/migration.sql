-- CreateEnum
CREATE TYPE "BankTransactionStatus" AS ENUM ('open', 'booked', 'ignored');

-- AlterTable
ALTER TABLE "InvoicePayment" ADD COLUMN     "bankTransactionId" TEXT;

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "accountIban" TEXT,
    "bookingDate" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "debtorName" TEXT,
    "debtorIban" TEXT,
    "remittance" TEXT,
    "status" "BankTransactionStatus" NOT NULL DEFAULT 'open',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankTransaction_companyId_status_idx" ON "BankTransaction"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_companyId_dedupeKey_key" ON "BankTransaction"("companyId", "dedupeKey");

-- CreateIndex
CREATE INDEX "InvoicePayment_bankTransactionId_idx" ON "InvoicePayment"("bankTransactionId");

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Mandantentrennung (siehe tenant_guard): Bankumsätze gehören zur Firma, und
-- eine Zahlung darf nur auf einen Bankumsatz derselben Firma verweisen
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "BankTransaction"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId');

DROP TRIGGER tenant_guard ON "InvoicePayment";
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "InvoicePayment"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'invoiceId:Invoice', 'bankTransactionId:BankTransaction');
