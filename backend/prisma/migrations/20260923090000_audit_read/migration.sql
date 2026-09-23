-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_entityId_idx" ON "AuditLog"("companyId", "entityId");


-- Neues Recht "audit.read" (Protokoll lesen). Bestehende Datenbanken
-- bekommen es hier; Rollen, die Systemeinstellungen ändern dürfen
-- (Administratoren), erhalten es automatisch.
INSERT INTO "Permission" ("id", "key", "label")
VALUES (gen_random_uuid()::text, 'audit.read', 'audit.read')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT rp."roleId", audit.id
FROM "RolePermission" rp
JOIN "Permission" settings ON settings.id = rp."permissionId" AND settings.key = 'system.settings.write'
CROSS JOIN (SELECT id FROM "Permission" WHERE key = 'audit.read') audit
ON CONFLICT DO NOTHING;
