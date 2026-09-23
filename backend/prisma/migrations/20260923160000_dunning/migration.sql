-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "dunningDeadlineDays" INTEGER NOT NULL DEFAULT 7;

-- CreateTable
CREATE TABLE "DunningNotice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "issuedOn" DATE NOT NULL,
    "deadline" DATE NOT NULL,
    "openAmount" DECIMAL(12,2) NOT NULL,
    "createdByUserId" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DunningNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DunningNotice_companyId_idx" ON "DunningNotice"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "DunningNotice_invoiceId_level_key" ON "DunningNotice"("invoiceId", "level");

-- AddForeignKey
ALTER TABLE "DunningNotice" ADD CONSTRAINT "DunningNotice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DunningNotice" ADD CONSTRAINT "DunningNotice_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Mandantentrennung wie bei allen anderen Tabellen (siehe tenant_guard)
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "DunningNotice"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'invoiceId:Invoice');
