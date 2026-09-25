-- Geräte und Fahrzeuge: Schäden, Wartung mit Fälligkeit, Inventur
-- CreateEnum
CREATE TYPE "EquipmentKind" AS ENUM ('vehicle', 'machine', 'trailer', 'tool', 'other');

-- CreateEnum
CREATE TYPE "EquipmentStatus" AS ENUM ('ready', 'limited', 'broken');

-- CreateEnum
CREATE TYPE "DamageSeverity" AS ENUM ('minor', 'limited', 'unusable');

-- CreateEnum
CREATE TYPE "DamageStatus" AS ENUM ('open', 'in_repair', 'fixed');

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "EquipmentKind" NOT NULL,
    "inventoryNumber" TEXT,
    "licensePlate" TEXT,
    "serialNumber" TEXT,
    "location" TEXT,
    "status" "EquipmentStatus" NOT NULL DEFAULT 'ready',
    "retired" BOOLEAN NOT NULL DEFAULT false,
    "machineId" TEXT,
    "notes" TEXT,
    "lastInventoryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentDamage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "projectId" TEXT,
    "reportedByUserId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "DamageSeverity" NOT NULL,
    "status" "DamageStatus" NOT NULL DEFAULT 'open',
    "repairCost" DECIMAL(10,2),
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentDamage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentMaintenance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "intervalMonths" INTEGER,
    "nextDue" DATE NOT NULL,
    "lastDone" DATE,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentMaintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentMaintenanceLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "maintenanceId" TEXT NOT NULL,
    "doneOn" DATE NOT NULL,
    "userId" TEXT NOT NULL,
    "note" TEXT,
    "cost" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentMaintenanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startedByUserId" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCountItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "found" BOOLEAN NOT NULL,
    "location" TEXT,
    "note" TEXT,
    "countedByUserId" TEXT NOT NULL,
    "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryCountItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Equipment_companyId_name_idx" ON "Equipment"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_companyId_inventoryNumber_key" ON "Equipment"("companyId", "inventoryNumber");

-- CreateIndex
CREATE INDEX "EquipmentDamage_companyId_status_idx" ON "EquipmentDamage"("companyId", "status");

-- CreateIndex
CREATE INDEX "EquipmentDamage_equipmentId_createdAt_idx" ON "EquipmentDamage"("equipmentId", "createdAt");

-- CreateIndex
CREATE INDEX "EquipmentMaintenance_companyId_nextDue_idx" ON "EquipmentMaintenance"("companyId", "nextDue");

-- CreateIndex
CREATE INDEX "EquipmentMaintenanceLog_maintenanceId_doneOn_idx" ON "EquipmentMaintenanceLog"("maintenanceId", "doneOn");

-- CreateIndex
CREATE INDEX "InventoryCount_companyId_createdAt_idx" ON "InventoryCount"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCountItem_countId_equipmentId_key" ON "InventoryCountItem"("countId", "equipmentId");

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentDamage" ADD CONSTRAINT "EquipmentDamage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentDamage" ADD CONSTRAINT "EquipmentDamage_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMaintenance" ADD CONSTRAINT "EquipmentMaintenance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMaintenance" ADD CONSTRAINT "EquipmentMaintenance_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMaintenanceLog" ADD CONSTRAINT "EquipmentMaintenanceLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMaintenanceLog" ADD CONSTRAINT "EquipmentMaintenanceLog_maintenanceId_fkey" FOREIGN KEY ("maintenanceId") REFERENCES "EquipmentMaintenance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountItem" ADD CONSTRAINT "InventoryCountItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountItem" ADD CONSTRAINT "InventoryCountItem_countId_fkey" FOREIGN KEY ("countId") REFERENCES "InventoryCount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountItem" ADD CONSTRAINT "InventoryCountItem_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Mandantentrennung (siehe tenant_guard)
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "Equipment"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'machineId:Machine');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "EquipmentDamage"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'equipmentId:Equipment', 'projectId:Project', 'reportedByUserId:User', 'resolvedByUserId:User');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "EquipmentMaintenance"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'equipmentId:Equipment');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "EquipmentMaintenanceLog"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'maintenanceId:EquipmentMaintenance', 'userId:User');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "InventoryCount"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'startedByUserId:User', 'closedByUserId:User');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "InventoryCountItem"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'countId:InventoryCount', 'equipmentId:Equipment', 'countedByUserId:User');
