-- Checklisten mit Vorlagen; Recht checklist.manage und Standardrolle Einsatzplaner
-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('proposed', 'approved', 'archived');

-- CreateTable
CREATE TABLE "ChecklistTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "items" JSONB NOT NULL,
    "status" "TemplateStatus" NOT NULL,
    "proposedByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Checklist" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "templateId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Checklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "addedByUserId" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3),
    "doneByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistComment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "itemId" TEXT,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChecklistTemplate_companyId_status_idx" ON "ChecklistTemplate"("companyId", "status");

-- CreateIndex
CREATE INDEX "Checklist_companyId_projectId_idx" ON "Checklist"("companyId", "projectId");

-- CreateIndex
CREATE INDEX "ChecklistItem_checklistId_position_idx" ON "ChecklistItem"("checklistId", "position");

-- CreateIndex
CREATE INDEX "ChecklistComment_checklistId_createdAt_idx" ON "ChecklistComment"("checklistId", "createdAt");

-- AddForeignKey
ALTER TABLE "ChecklistTemplate" ADD CONSTRAINT "ChecklistTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "Checklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistComment" ADD CONSTRAINT "ChecklistComment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistComment" ADD CONSTRAINT "ChecklistComment_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "Checklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistComment" ADD CONSTRAINT "ChecklistComment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ChecklistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Mandantentrennung (siehe tenant_guard)
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "ChecklistTemplate"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'proposedByUserId:User', 'reviewedByUserId:User');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "Checklist"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'projectId:Project', 'templateId:ChecklistTemplate', 'createdByUserId:User');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "ChecklistItem"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'checklistId:Checklist', 'addedByUserId:User', 'doneByUserId:User');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "ChecklistComment"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'checklistId:Checklist', 'itemId:ChecklistItem', 'userId:User');

-- Recht "Checklisten verwalten" (Vorlagen anlegen und prüfen, Listen am
-- Projekt anlegen): für alle Rollen mit Systemeinstellungen (Geschäftsführung)
INSERT INTO "Permission" ("id", "key", "label")
VALUES (gen_random_uuid()::text, 'checklist.manage', 'checklist.manage')
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT rp."roleId", cm.id
FROM "RolePermission" rp
JOIN "Permission" base ON base.id = rp."permissionId" AND base.key = 'system.settings.write'
CROSS JOIN (SELECT id FROM "Permission" WHERE key = 'checklist.manage') cm
ON CONFLICT DO NOTHING;

-- Standardrolle "Einsatzplaner" je Firma (wie Mitarbeiter plus Checklisten
-- verwalten); gleiche Liste wie PLANNER_PERMISSIONS in common/permissions.ts
INSERT INTO "Role" ("id", "companyId", "name", "isSystem")
SELECT gen_random_uuid()::text, c.id, 'Einsatzplaner', true
FROM "Company" c
ON CONFLICT ("companyId", "name") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "Role" r
JOIN "Permission" p ON p.key IN ('customer.read', 'ai.use', 'plan.read', 'site.use', 'checklist.manage')
WHERE r.name = 'Einsatzplaner' AND r."isSystem"
ON CONFLICT DO NOTHING;
