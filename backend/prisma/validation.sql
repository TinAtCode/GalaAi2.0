-- Handgeschriebene Übersetzung von prisma/schema.prisma nach SQL, um das
-- Datenmodell in dieser Sandbox gegen eine echte PostgreSQL-Instanz zu
-- verifizieren (die Prisma-CLI selbst kann hier keine Engine-Binaries laden,
-- siehe STATUS.md). Auf einer Maschine mit normalem Internetzugang ersetzt
-- `npx prisma migrate dev --name init` diese Datei durch die offizielle,
-- generierte Migration – diese Datei ist NUR ein Validierungswerkzeug.

CREATE TABLE "Company" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "hourlyLaborRate" NUMERIC(10,2) NOT NULL DEFAULT 45.00,
  "overheadPercent" NUMERIC(5,2) NOT NULL DEFAULT 15.00,
  "defaultSurchargePercent" NUMERIC(5,2) NOT NULL DEFAULT 20.00
);

CREATE TABLE "User" (
  id TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "Company"(id),
  email TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE TABLE "Role" (
  id TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "Company"(id),
  name TEXT NOT NULL,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  UNIQUE ("companyId", name)
);

CREATE TABLE "UserRole" (
  "userId" TEXT NOT NULL REFERENCES "User"(id),
  "roleId" TEXT NOT NULL REFERENCES "Role"(id),
  PRIMARY KEY ("userId", "roleId")
);

CREATE TABLE "Permission" (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL
);

CREATE TABLE "RolePermission" (
  "roleId" TEXT NOT NULL REFERENCES "Role"(id),
  "permissionId" TEXT NOT NULL REFERENCES "Permission"(id),
  PRIMARY KEY ("roleId", "permissionId")
);

CREATE TABLE "Customer" (
  id TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "Company"(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE TABLE "Property" (
  id TEXT PRIMARY KEY,
  "customerId" TEXT NOT NULL REFERENCES "Customer"(id),
  label TEXT NOT NULL,
  street TEXT,
  "postalCode" TEXT,
  city TEXT
);

CREATE TABLE "Project" (
  id TEXT PRIMARY KEY,
  "propertyId" TEXT NOT NULL REFERENCES "Property"(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE TABLE "Quote" (
  id TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES "Project"(id),
  status TEXT NOT NULL DEFAULT 'draft',
  "totalNet" NUMERIC(12,2) NOT NULL,
  "validUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE TABLE "QuoteLineItem" (
  id TEXT PRIMARY KEY,
  "quoteId" TEXT NOT NULL REFERENCES "Quote"(id),
  "serviceId" TEXT,
  description TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL,
  "costPerUnit" NUMERIC(10,2) NOT NULL,
  "unitPrice" NUMERIC(10,2) NOT NULL,
  "marginPerUnit" NUMERIC(10,2) NOT NULL,
  "lineTotal" NUMERIC(12,2) NOT NULL
);

CREATE TABLE "Order" (
  id TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES "Project"(id),
  "quoteId" TEXT NOT NULL UNIQUE REFERENCES "Quote"(id),
  status TEXT NOT NULL DEFAULT 'open',
  "totalNet" NUMERIC(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE TABLE "Article" (
  id TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "Company"(id),
  "articleNumber" TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  "purchasePrice" NUMERIC(10,2) NOT NULL,
  "salePrice" NUMERIC(10,2) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE ("companyId", "articleNumber")
);

CREATE TABLE "Service" (
  id TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "Company"(id),
  name TEXT NOT NULL,
  unit TEXT NOT NULL
);

CREATE TABLE "ServiceComponent" (
  id TEXT PRIMARY KEY,
  "serviceId" TEXT NOT NULL REFERENCES "Service"(id),
  "articleId" TEXT REFERENCES "Article"(id),
  "quantityPer" NUMERIC(10,4) NOT NULL,
  "laborMinutes" INTEGER
);

CREATE TABLE "Supplier" (
  id TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "Company"(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE "Machine" (
  id TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "Company"(id),
  name TEXT NOT NULL,
  "hourlyRate" NUMERIC(10,2) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE "Appointment" (
  id TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES "Project"(id),
  title TEXT NOT NULL,
  "startTime" TIMESTAMP(3) NOT NULL,
  "endTime" TIMESTAMP(3),
  "assignedUserId" TEXT REFERENCES "User"(id),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE TABLE "Employee" (
  id TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "Company"(id),
  "userId" TEXT UNIQUE REFERENCES "User"(id),
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE "TimeEntry" (
  id TEXT PRIMARY KEY,
  "employeeId" TEXT NOT NULL REFERENCES "Employee"(id),
  "projectId" TEXT REFERENCES "Project"(id),
  "startTime" TIMESTAMP(3) NOT NULL,
  "endTime" TIMESTAMP(3),
  "breakMinutes" INTEGER NOT NULL DEFAULT 0,
  activity TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE TABLE "Document" (
  id TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "Company"(id),
  "projectId" TEXT REFERENCES "Project"(id),
  "fileName" TEXT NOT NULL,
  "documentType" TEXT NOT NULL DEFAULT 'other',
  "storagePath" TEXT NOT NULL,
  "uploadedByUserId" TEXT REFERENCES "User"(id),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE TABLE "ProjectMaterialUsage" (
  id TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES "Project"(id),
  "articleId" TEXT NOT NULL REFERENCES "Article"(id),
  quantity NUMERIC(10,2) NOT NULL,
  "recordedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE TABLE "AuditLog" (
  id TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "Company"(id),
  "userId" TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  "entityId" TEXT,
  "oldData" JSONB,
  "newData" JSONB,
  source TEXT NOT NULL DEFAULT 'manual',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
