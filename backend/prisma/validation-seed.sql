-- SQL-Fassung von prisma/seed.ts, NUR zur Validierung in dieser Sandbox
-- (kein Ersatz für den echten Seed, der über Prisma Client läuft).

DO $$
DECLARE
  v_company_id TEXT := gen_random_uuid();
  v_admin_id TEXT := gen_random_uuid();
  v_owner_role_id TEXT := gen_random_uuid();
  v_customer_id TEXT := gen_random_uuid();
  v_property_id TEXT := gen_random_uuid();
  v_project_id TEXT := gen_random_uuid();
  v_article_id TEXT := gen_random_uuid();
  v_service_id TEXT := gen_random_uuid();
  v_component_material_id TEXT := gen_random_uuid();
  v_component_labor_id TEXT := gen_random_uuid();
  v_employee_id TEXT := gen_random_uuid();
  v_quote_id TEXT := gen_random_uuid();
  v_lineitem_id TEXT := gen_random_uuid();
  v_order_id TEXT := gen_random_uuid();
  v_appointment_id TEXT := gen_random_uuid();
  v_timeentry_id TEXT := gen_random_uuid();
  v_usage_id TEXT := gen_random_uuid();
  v_permission_id TEXT := gen_random_uuid();
BEGIN
  INSERT INTO "Company" (id, name) VALUES (v_company_id, 'Musterbetrieb GaLaBau GmbH');

  INSERT INTO "Permission" (id, key, label) VALUES (v_permission_id, 'customer.read', 'customer.read');

  INSERT INTO "Role" (id, "companyId", name, "isSystem") VALUES (v_owner_role_id, v_company_id, 'Geschäftsführung', true);
  INSERT INTO "RolePermission" ("roleId", "permissionId") VALUES (v_owner_role_id, v_permission_id);

  INSERT INTO "User" (id, "companyId", email, "passwordHash", "firstName", "lastName")
    VALUES (v_admin_id, v_company_id, 'admin@musterbetrieb.de', 'x', 'Max', 'Mustermann');
  INSERT INTO "UserRole" ("userId", "roleId") VALUES (v_admin_id, v_owner_role_id);

  INSERT INTO "Employee" (id, "companyId", "userId", "firstName", "lastName")
    VALUES (v_employee_id, v_company_id, v_admin_id, 'Max', 'Mustermann');

  INSERT INTO "Customer" (id, "companyId", name, email) VALUES (v_customer_id, v_company_id, 'Familie Müller', 'mueller@example.com');
  INSERT INTO "Property" (id, "customerId", label, street, city) VALUES (v_property_id, v_customer_id, 'Hauptwohnsitz', 'Gartenweg 1', 'Musterstadt');
  INSERT INTO "Project" (id, "propertyId", title) VALUES (v_project_id, v_property_id, 'Terrassenbau Familie Müller');

  INSERT INTO "Article" (id, "companyId", "articleNumber", name, unit, "purchasePrice", "salePrice")
    VALUES (v_article_id, v_company_id, 'ART-001', 'Schotter 0/32', 'Sack', 3.50, 6.00);

  INSERT INTO "Service" (id, "companyId", name, unit) VALUES (v_service_id, v_company_id, '1 m² Terrasse verlegen', 'm2');
  INSERT INTO "ServiceComponent" (id, "serviceId", "articleId", "quantityPer", "laborMinutes")
    VALUES (v_component_material_id, v_service_id, v_article_id, 2, NULL);
  INSERT INTO "ServiceComponent" (id, "serviceId", "articleId", "quantityPer", "laborMinutes")
    VALUES (v_component_labor_id, v_service_id, NULL, 0, 20);

  -- Kalkulation für 10 m²: Material 10*2*3.50=70 (Einkauf), Arbeitszeit 10*20=200min*45€/h=150,
  -- Gemeinkosten 15% von (70+150)=33, Kosten=253, Aufschlag 20% -> Verkauf=303.60, Marge=50.60
  INSERT INTO "Quote" (id, "projectId", status, "totalNet") VALUES (v_quote_id, v_project_id, 'accepted', 303.60);
  INSERT INTO "QuoteLineItem" (id, "quoteId", "serviceId", description, unit, quantity, "costPerUnit", "unitPrice", "marginPerUnit", "lineTotal")
    VALUES (v_lineitem_id, v_quote_id, v_service_id, '1 m² Terrasse verlegen', 'm2', 10, 25.30, 30.36, 5.06, 303.60);

  INSERT INTO "Order" (id, "projectId", "quoteId", "totalNet") VALUES (v_order_id, v_project_id, v_quote_id, 303.60);

  INSERT INTO "Appointment" (id, "projectId", title, "startTime", "assignedUserId")
    VALUES (v_appointment_id, v_project_id, 'Aufmaß nehmen', now(), v_admin_id);

  INSERT INTO "TimeEntry" (id, "employeeId", "projectId", "startTime", "endTime", "breakMinutes", status)
    VALUES (v_timeentry_id, v_employee_id, v_project_id, now() - interval '4 hours', now(), 30, 'completed');

  INSERT INTO "ProjectMaterialUsage" (id, "projectId", "articleId", quantity, "recordedByUserId")
    VALUES (v_usage_id, v_project_id, v_article_id, 18, v_admin_id);

  INSERT INTO "AuditLog" (id, "companyId", "userId", action, entity, "entityId", source)
    VALUES (gen_random_uuid(), v_company_id, v_admin_id, 'seed_validation', 'Project', v_project_id, 'system');

  RAISE NOTICE 'Validierungskette erfolgreich eingefügt. project_id=%', v_project_id;
END $$;
