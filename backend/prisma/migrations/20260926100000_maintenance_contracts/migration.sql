-- Pflege- und Wartungsverträge (siehe MaintenanceContract im Schema)
-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('active', 'paused', 'ended');

-- AlterEnum
ALTER TYPE "InvoiceKind" ADD VALUE 'periodic';

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "contractTaskId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "contractId" TEXT,
ALTER COLUMN "orderId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "MaintenanceContract" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'active',
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "billingInterval" "RecurringInterval" NOT NULL DEFAULT 'monthly',
    "billInAdvance" BOOLEAN NOT NULL DEFAULT true,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "vatTreatment" "VatTreatment" NOT NULL DEFAULT 'standard',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractLine" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "ContractLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractTask" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "everyWeeks" INTEGER NOT NULL,
    "seasonFrom" INTEGER NOT NULL DEFAULT 1,
    "seasonTo" INTEGER NOT NULL DEFAULT 12,
    "startMinutes" INTEGER NOT NULL DEFAULT 480,
    "durationMinutes" INTEGER NOT NULL DEFAULT 120,
    "assignedUserId" TEXT,
    "nextDue" DATE NOT NULL,

    CONSTRAINT "ContractTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenanceContract_companyId_idx" ON "MaintenanceContract"("companyId");

-- CreateIndex
CREATE INDEX "MaintenanceContract_projectId_idx" ON "MaintenanceContract"("projectId");

-- CreateIndex
CREATE INDEX "ContractLine_contractId_idx" ON "ContractLine"("contractId");

-- CreateIndex
CREATE INDEX "ContractTask_companyId_idx" ON "ContractTask"("companyId");

-- CreateIndex
CREATE INDEX "ContractTask_contractId_idx" ON "ContractTask"("contractId");

-- CreateIndex
CREATE INDEX "ContractTask_assignedUserId_idx" ON "ContractTask"("assignedUserId");

-- CreateIndex
CREATE INDEX "Appointment_contractTaskId_idx" ON "Appointment"("contractTaskId");

-- CreateIndex
CREATE INDEX "Invoice_contractId_idx" ON "Invoice"("contractId");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_contractTaskId_fkey" FOREIGN KEY ("contractTaskId") REFERENCES "ContractTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceContract" ADD CONSTRAINT "MaintenanceContract_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceContract" ADD CONSTRAINT "MaintenanceContract_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractLine" ADD CONSTRAINT "ContractLine_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "MaintenanceContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractTask" ADD CONSTRAINT "ContractTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractTask" ADD CONSTRAINT "ContractTask_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "MaintenanceContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractTask" ADD CONSTRAINT "ContractTask_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "MaintenanceContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Eine Rechnung gehört zu genau einem Auftrag oder einem Pflegevertrag
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_source_check"
  CHECK (("orderId" IS NOT NULL) <> ("contractId" IS NOT NULL));

-- Mandantentrennung (siehe tenant_guard)
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "MaintenanceContract"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'projectId:Project');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "ContractLine"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('contractId:MaintenanceContract');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "ContractTask"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'contractId:MaintenanceContract', 'assignedUserId:User');
DROP TRIGGER tenant_guard ON "Invoice";
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "Invoice"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'projectId:Project', 'orderId:Order', 'contractId:MaintenanceContract', 'cancelsInvoiceId:Invoice');
DROP TRIGGER tenant_guard ON "Appointment";
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "Appointment"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'projectId:Project', 'assignedUserId:User', 'contractTaskId:ContractTask');
