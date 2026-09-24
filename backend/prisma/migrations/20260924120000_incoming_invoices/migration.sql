-- Eingangsrechnungen (siehe IncomingInvoice im Schema)
-- CreateEnum
CREATE TYPE "PayableStatus" AS ENUM ('open', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "PayableSource" AS ENUM ('manual', 'text', 'einvoice');

-- CreateTable
CREATE TABLE "IncomingInvoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "supplierIban" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" DATE,
    "dueDate" DATE,
    "amount" DECIMAL(12,2) NOT NULL,
    "netAmount" DECIMAL(12,2),
    "vatAmount" DECIMAL(12,2),
    "discountPercent" DECIMAL(5,2),
    "discountUntil" DATE,
    "categoryId" TEXT,
    "documentId" TEXT,
    "source" "PayableSource" NOT NULL DEFAULT 'manual',
    "status" "PayableStatus" NOT NULL DEFAULT 'open',
    "paidAt" DATE,
    "paidAmount" DECIMAL(12,2),
    "bankTransactionId" TEXT,
    "rejectedTransactionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomingInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncomingInvoice_documentId_key" ON "IncomingInvoice"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "IncomingInvoice_bankTransactionId_key" ON "IncomingInvoice"("bankTransactionId");

-- CreateIndex
CREATE INDEX "IncomingInvoice_companyId_status_idx" ON "IncomingInvoice"("companyId", "status");

-- AddForeignKey
ALTER TABLE "IncomingInvoice" ADD CONSTRAINT "IncomingInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomingInvoice" ADD CONSTRAINT "IncomingInvoice_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomingInvoice" ADD CONSTRAINT "IncomingInvoice_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomingInvoice" ADD CONSTRAINT "IncomingInvoice_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Mandantentrennung (siehe tenant_guard): Kategorie, Beleg und Abbuchung
-- müssen zur selben Firma gehören
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "IncomingInvoice"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'categoryId:ExpenseCategory', 'documentId:Document', 'bankTransactionId:BankTransaction');
