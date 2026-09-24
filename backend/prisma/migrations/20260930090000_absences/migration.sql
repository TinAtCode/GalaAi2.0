-- Abwesenheiten (Urlaub, Krankheit, Schulung) für die Plantafel
-- CreateEnum
CREATE TYPE "AbsenceKind" AS ENUM ('vacation', 'sick', 'training', 'other');

-- CreateTable
CREATE TABLE "Absence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AbsenceKind" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Absence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Absence_dates_check" CHECK ("endDate" >= "startDate")
);

-- CreateIndex
CREATE INDEX "Absence_companyId_startDate_idx" ON "Absence"("companyId", "startDate");

-- CreateIndex
CREATE INDEX "Absence_userId_startDate_idx" ON "Absence"("userId", "startDate");

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mandantentrennung (siehe tenant_guard)
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "Absence"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'userId:User', 'createdByUserId:User');
