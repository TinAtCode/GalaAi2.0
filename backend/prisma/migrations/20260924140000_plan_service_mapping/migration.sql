-- Zuordnung Planmenge -> Leistung (siehe PlanServiceMapping)
-- CreateTable
CREATE TABLE "PlanServiceMapping" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "quantityKey" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "PlanServiceMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanServiceMapping_companyId_quantityKey_key" ON "PlanServiceMapping"("companyId", "quantityKey");

-- AddForeignKey
ALTER TABLE "PlanServiceMapping" ADD CONSTRAINT "PlanServiceMapping_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanServiceMapping" ADD CONSTRAINT "PlanServiceMapping_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Mandantentrennung (siehe tenant_guard)
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "PlanServiceMapping"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'serviceId:Service');
