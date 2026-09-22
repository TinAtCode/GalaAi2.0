-- AlterTable
ALTER TABLE "ServiceComponent" ADD COLUMN     "machineId" TEXT,
ADD COLUMN     "machineMinutes" INTEGER;

-- CreateIndex
CREATE INDEX "ServiceComponent_machineId_idx" ON "ServiceComponent"("machineId");

-- AddForeignKey
ALTER TABLE "ServiceComponent" ADD CONSTRAINT "ServiceComponent_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
