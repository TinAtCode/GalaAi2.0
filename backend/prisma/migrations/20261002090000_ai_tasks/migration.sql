-- KI-Aufgaben: Zuordnung zu Anbietern, Fähigkeiten der Anbieter; Anschreiben im Angebot
-- AlterTable
ALTER TABLE "AiProviderConfig" ADD COLUMN "capabilities" TEXT[] DEFAULT ARRAY['text']::TEXT[];

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "introText" TEXT;

-- CreateTable
CREATE TABLE "AiTaskAssignment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "model" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiTaskAssignment_companyId_task_key" ON "AiTaskAssignment"("companyId", "task");

-- AddForeignKey
ALTER TABLE "AiTaskAssignment" ADD CONSTRAINT "AiTaskAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTaskAssignment" ADD CONSTRAINT "AiTaskAssignment_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "AiProviderConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mandantentrennung (siehe tenant_guard)
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "AiTaskAssignment"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'providerId:AiProviderConfig');
