-- Versicherungen und Verträge mit Laufzeit und Kündigungsfrist
-- CreateEnum
CREATE TYPE "BusinessContractKind" AS ENUM ('insurance', 'vehicle', 'lease', 'rent', 'telecom', 'software', 'energy', 'service', 'other');

-- CreateTable
CREATE TABLE "BusinessContract" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "BusinessContractKind" NOT NULL,
    "provider" TEXT,
    "contractNumber" TEXT,
    "amount" DECIMAL(12,2),
    "interval" "RecurringInterval",
    "startDate" DATE,
    "termEnd" DATE,
    "renewalMonths" INTEGER,
    "noticeMonths" INTEGER NOT NULL DEFAULT 3,
    "cancelledOn" DATE,
    "equipmentId" TEXT,
    "recurringPaymentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessContract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessContract_recurringPaymentId_key" ON "BusinessContract"("recurringPaymentId");

-- CreateIndex
CREATE INDEX "BusinessContract_companyId_termEnd_idx" ON "BusinessContract"("companyId", "termEnd");

-- AddForeignKey
ALTER TABLE "BusinessContract" ADD CONSTRAINT "BusinessContract_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessContract" ADD CONSTRAINT "BusinessContract_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessContract" ADD CONSTRAINT "BusinessContract_recurringPaymentId_fkey" FOREIGN KEY ("recurringPaymentId") REFERENCES "RecurringPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Mandantentrennung (siehe tenant_guard)
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "BusinessContract"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'equipmentId:Equipment', 'recurringPaymentId:RecurringPayment');
