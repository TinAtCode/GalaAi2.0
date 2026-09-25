-- Bautagebuch je Projekt und Tag (Wetter, Besetzung, Arbeiten, Verzögerungen)
-- CreateEnum
CREATE TYPE "DiaryWeather" AS ENUM ('sunny', 'cloudy', 'rain', 'snow', 'frost', 'storm', 'heat');

-- CreateEnum
CREATE TYPE "DiaryDelayReason" AS ENUM ('weather', 'material', 'customer', 'other_trade', 'equipment', 'plans', 'staff', 'other');

-- CreateTable
CREATE TABLE "SiteDiaryEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "weather" "DiaryWeather",
    "temperature" INTEGER,
    "crew" TEXT,
    "crewCount" INTEGER,
    "work" TEXT,
    "delayHours" DECIMAL(5,2),
    "delayReason" "DiaryDelayReason",
    "delayNote" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteDiaryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteDiaryEntry_companyId_day_idx" ON "SiteDiaryEntry"("companyId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "SiteDiaryEntry_projectId_day_key" ON "SiteDiaryEntry"("projectId", "day");

-- AddForeignKey
ALTER TABLE "SiteDiaryEntry" ADD CONSTRAINT "SiteDiaryEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteDiaryEntry" ADD CONSTRAINT "SiteDiaryEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Mandantentrennung (siehe tenant_guard)
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "SiteDiaryEntry"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'projectId:Project', 'createdByUserId:User', 'updatedByUserId:User');
