-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "ocrStatus" "OcrJobStatus",
ADD COLUMN     "ocrText" TEXT;

-- AlterTable
ALTER TABLE "OcrJob" ADD COLUMN     "documentId" TEXT;

-- CreateIndex
CREATE INDEX "OcrJob_documentId_idx" ON "OcrJob"("documentId");

-- AddForeignKey
ALTER TABLE "OcrJob" ADD CONSTRAINT "OcrJob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Mandantentrennung (siehe tenant_guard): ein OCR-Auftrag nur zu einem
-- Dokument derselben Firma
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "OcrJob"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'documentId:Document');

-- Neues Recht "document.delete" (Dokumente löschen); Lesen allein erlaubt es
-- nicht. Rollen, die Systemeinstellungen ändern dürfen (Administratoren),
-- erhalten es automatisch.
INSERT INTO "Permission" ("id", "key", "label")
VALUES (gen_random_uuid()::text, 'document.delete', 'document.delete')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT rp."roleId", del.id
FROM "RolePermission" rp
JOIN "Permission" settings ON settings.id = rp."permissionId" AND settings.key = 'system.settings.write'
CROSS JOIN (SELECT id FROM "Permission" WHERE key = 'document.delete') del
ON CONFLICT DO NOTHING;
