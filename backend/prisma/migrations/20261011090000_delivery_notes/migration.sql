-- Projektnummer, Lieferanten-Erkennung, Lieferscheine
-- CreateEnum
CREATE TYPE "DeliveryNoteStatus" AS ENUM ('open', 'confirmed');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "number" TEXT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "customerNumber" TEXT,
ADD COLUMN     "matchTerms" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "DeliveryNote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "supplierId" TEXT,
    "projectId" TEXT,
    "noteNumber" TEXT,
    "noteDate" DATE,
    "status" "DeliveryNoteStatus" NOT NULL DEFAULT 'open',
    "hints" JSONB,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryNote_documentId_key" ON "DeliveryNote"("documentId");

-- CreateIndex
CREATE INDEX "DeliveryNote_companyId_status_idx" ON "DeliveryNote"("companyId", "status");

-- CreateIndex
CREATE INDEX "DeliveryNote_projectId_idx" ON "DeliveryNote"("projectId");

-- Bestehende Projekte bekommen fortlaufende Nummern je Firma und Anlagejahr
UPDATE "Project" p
SET "number" = 'P-' || s.y || '-' || lpad(s.rn::text, 4, '0')
FROM (
  SELECT id, extract(year FROM "createdAt")::int AS y,
         row_number() OVER (PARTITION BY "companyId", extract(year FROM "createdAt") ORDER BY "createdAt", id) AS rn
  FROM "Project"
) s
WHERE s.id = p.id AND p."number" IS NULL;

-- Zähler fortschreiben, damit neue Projekte daran anschließen
INSERT INTO "NumberSequence" ("companyId", "kind", "year", "lastValue")
SELECT "companyId", 'project', extract(year FROM "createdAt")::int, count(*)
FROM "Project"
GROUP BY "companyId", extract(year FROM "createdAt")
ON CONFLICT ("companyId", "kind", "year") DO UPDATE SET "lastValue" = GREATEST("NumberSequence"."lastValue", EXCLUDED."lastValue");

-- CreateIndex
CREATE UNIQUE INDEX "Project_companyId_number_key" ON "Project"("companyId", "number");

-- AddForeignKey
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Mandantentrennung (siehe tenant_guard)
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "DeliveryNote"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'documentId:Document', 'supplierId:Supplier', 'projectId:Project', 'confirmedByUserId:User');
