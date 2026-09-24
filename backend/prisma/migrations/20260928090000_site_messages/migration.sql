-- Baustelle: Nachrichten und Fotos je Projekt, Recht site.use
-- CreateTable
CREATE TABLE "ProjectMessage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "text" TEXT,
    "documentId" TEXT,
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMessageRead" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMessageRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMessage_documentId_key" ON "ProjectMessage"("documentId");

-- CreateIndex
CREATE INDEX "ProjectMessage_companyId_idx" ON "ProjectMessage"("companyId");

-- CreateIndex
CREATE INDEX "ProjectMessage_projectId_createdAt_idx" ON "ProjectMessage"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMessage_companyId_clientId_key" ON "ProjectMessage"("companyId", "clientId");

-- CreateIndex
CREATE INDEX "ProjectMessageRead_companyId_idx" ON "ProjectMessageRead"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMessageRead_projectId_userId_key" ON "ProjectMessageRead"("projectId", "userId");

-- AddForeignKey
ALTER TABLE "ProjectMessage" ADD CONSTRAINT "ProjectMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMessage" ADD CONSTRAINT "ProjectMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMessage" ADD CONSTRAINT "ProjectMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMessage" ADD CONSTRAINT "ProjectMessage_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMessageRead" ADD CONSTRAINT "ProjectMessageRead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMessageRead" ADD CONSTRAINT "ProjectMessageRead_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMessageRead" ADD CONSTRAINT "ProjectMessageRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Mandantentrennung (siehe tenant_guard)
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "ProjectMessage"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'projectId:Project', 'authorUserId:User', 'documentId:Document');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "ProjectMessageRead"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'projectId:Project', 'userId:User');

-- Recht "Baustelle" (Fotos, Nachrichten, eigene Termine erledigen): für alle
-- Rollen, die Kunden/Projekte sehen – außer der Standardrolle "Buchhaltung"
-- (wie plan.read in 20260924130000_site_plans)
INSERT INTO "Permission" ("id", "key", "label")
VALUES (gen_random_uuid()::text, 'site.use', 'site.use')
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT rp."roleId", site.id
FROM "RolePermission" rp
JOIN "Permission" base ON base.id = rp."permissionId" AND base.key = 'customer.read'
JOIN "Role" r ON r.id = rp."roleId" AND NOT (r.name = 'Buchhaltung' AND r."isSystem")
CROSS JOIN (SELECT id FROM "Permission" WHERE key = 'site.use') site
ON CONFLICT DO NOTHING;
