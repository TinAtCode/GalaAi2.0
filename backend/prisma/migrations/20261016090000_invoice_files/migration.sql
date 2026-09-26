-- Archiv der ausgestellten Rechnungen (GoBD): PDF und E-Rechnung wie ausgestellt
CREATE TYPE "InvoiceFileKind" AS ENUM ('pdf', 'xml');

CREATE TABLE "InvoiceFile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" "InvoiceFileKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceFile_invoiceId_kind_key" ON "InvoiceFile"("invoiceId", "kind");
CREATE INDEX "InvoiceFile_companyId_idx" ON "InvoiceFile"("companyId");

ALTER TABLE "InvoiceFile" ADD CONSTRAINT "InvoiceFile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceFile" ADD CONSTRAINT "InvoiceFile_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mandantentrennung (siehe tenant_guard)
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "InvoiceFile"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'invoiceId:Invoice');

-- Archivierte Dateien sind unveränderlich, auch an der Anwendung vorbei;
-- archiviert werden nur ausgestellte (oder stornierte) Rechnungen
CREATE FUNCTION invoice_file_guard() RETURNS trigger AS $$
DECLARE
  parent_status "InvoiceStatus";
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO parent_status FROM "Invoice" WHERE id = NEW."invoiceId";
    IF parent_status = 'draft' THEN
      RAISE EXCEPTION 'Entwürfe werden nicht archiviert';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Archivierte Rechnungsdateien sind unveränderlich';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_file_guard
BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceFile"
FOR EACH ROW EXECUTE FUNCTION invoice_file_guard();
