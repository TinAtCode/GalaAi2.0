-- Kalender: Firmen- und persönliche Termine
-- CreateEnum
CREATE TYPE "CalendarScope" AS ENUM ('company', 'personal');

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "scope" "CalendarScope" NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarEvent_companyId_startTime_idx" ON "CalendarEvent"("companyId", "startTime");

-- CreateIndex
CREATE INDEX "CalendarEvent_ownerUserId_startTime_idx" ON "CalendarEvent"("ownerUserId", "startTime");

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Mandantentrennung (siehe tenant_guard)
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "CalendarEvent"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'ownerUserId:User');
