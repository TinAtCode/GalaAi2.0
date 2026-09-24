-- Lagepläne am Projekt (siehe SitePlan im Schema)
-- CreateTable
CREATE TABLE "SitePlan" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitsPerMeter" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "backgroundDocumentId" TEXT,
    "backgroundWidth" INTEGER,
    "backgroundHeight" INTEGER,
    "objects" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SitePlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SitePlan_companyId_idx" ON "SitePlan"("companyId");

-- CreateIndex
CREATE INDEX "SitePlan_projectId_idx" ON "SitePlan"("projectId");

-- AddForeignKey
ALTER TABLE "SitePlan" ADD CONSTRAINT "SitePlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePlan" ADD CONSTRAINT "SitePlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePlan" ADD CONSTRAINT "SitePlan_backgroundDocumentId_fkey" FOREIGN KEY ("backgroundDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Mandantentrennung (siehe tenant_guard)
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "SitePlan"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'projectId:Project', 'backgroundDocumentId:Document');

-- Rechte: ansehen für alle Rollen, die Kunden/Projekte lesen dürfen (auch
-- "Mitarbeiter", nicht die Standardrolle "Buchhaltung" – wie EMPLOYEE_PERMISSIONS
-- und BOOKKEEPING_PERMISSIONS im Code), zeichnen für alle, die Kunden/Projekte
-- bearbeiten dürfen
INSERT INTO "Permission" ("id", "key", "label")
VALUES (gen_random_uuid()::text, 'plan.read', 'plan.read'), (gen_random_uuid()::text, 'plan.write', 'plan.write')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT rp."roleId", plan.id
FROM "RolePermission" rp
JOIN "Permission" base ON base.id = rp."permissionId" AND base.key = 'customer.read'
JOIN "Role" r ON r.id = rp."roleId" AND NOT (r.name = 'Buchhaltung' AND r."isSystem")
CROSS JOIN (SELECT id FROM "Permission" WHERE key = 'plan.read') plan
ON CONFLICT DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT rp."roleId", plan.id
FROM "RolePermission" rp
JOIN "Permission" base ON base.id = rp."permissionId" AND base.key = 'customer.write'
CROSS JOIN (SELECT id FROM "Permission" WHERE key = 'plan.write') plan
ON CONFLICT DO NOTHING;
