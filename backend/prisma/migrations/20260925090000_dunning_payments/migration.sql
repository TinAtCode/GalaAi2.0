-- AlterTable
ALTER TABLE "InvoicePayment" ADD COLUMN     "costsAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "interestAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "InvoiceChargeWaiver" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceChargeWaiver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceChargeWaiver_companyId_idx" ON "InvoiceChargeWaiver"("companyId");

-- CreateIndex
CREATE INDEX "InvoiceChargeWaiver_invoiceId_idx" ON "InvoiceChargeWaiver"("invoiceId");

-- AddForeignKey
ALTER TABLE "InvoiceChargeWaiver" ADD CONSTRAINT "InvoiceChargeWaiver_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceChargeWaiver" ADD CONSTRAINT "InvoiceChargeWaiver_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Anteile einer Zahlung sind nie negativ und zusammen höchstens der Betrag
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_split_check"
  CHECK ("costsAmount" >= 0 AND "interestAmount" >= 0 AND "costsAmount" + "interestAmount" <= "amount");

ALTER TABLE "InvoiceChargeWaiver" ADD CONSTRAINT "InvoiceChargeWaiver_amount_check" CHECK ("amount" > 0);

-- Mandantentrennung (siehe tenant_guard): Rechnung derselben Firma
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "InvoiceChargeWaiver"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'invoiceId:Invoice');
