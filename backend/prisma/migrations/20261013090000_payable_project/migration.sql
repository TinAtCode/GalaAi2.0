-- Eingangsrechnungen einem Projekt zuordnen (Einkauf/Fremdleistung für die Nachkalkulation)
ALTER TABLE "IncomingInvoice" ADD COLUMN "projectId" TEXT;

CREATE INDEX "IncomingInvoice_projectId_idx" ON "IncomingInvoice"("projectId");

ALTER TABLE "IncomingInvoice" ADD CONSTRAINT "IncomingInvoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Mandantentrennung (siehe tenant_guard): auch das Projekt muss zur selben Firma gehören
DROP TRIGGER tenant_guard ON "IncomingInvoice";
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "IncomingInvoice"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'categoryId:ExpenseCategory', 'documentId:Document', 'bankTransactionId:BankTransaction', 'projectId:Project');
