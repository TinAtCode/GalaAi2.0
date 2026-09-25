-- Eingangsrechnung ↔ Lieferant (Stammdaten) und Lieferschein ↔ Eingangsrechnung
ALTER TABLE "IncomingInvoice" ADD COLUMN "supplierId" TEXT;
ALTER TABLE "DeliveryNote" ADD COLUMN "incomingInvoiceId" TEXT;

CREATE INDEX "IncomingInvoice_supplierId_idx" ON "IncomingInvoice"("supplierId");
CREATE INDEX "DeliveryNote_incomingInvoiceId_idx" ON "DeliveryNote"("incomingInvoiceId");

ALTER TABLE "IncomingInvoice" ADD CONSTRAINT "IncomingInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_incomingInvoiceId_fkey" FOREIGN KEY ("incomingInvoiceId") REFERENCES "IncomingInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Mandantentrennung (siehe tenant_guard): Lieferant und Rechnung derselben Firma
DROP TRIGGER tenant_guard ON "IncomingInvoice";
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "IncomingInvoice"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'categoryId:ExpenseCategory', 'documentId:Document', 'bankTransactionId:BankTransaction', 'projectId:Project', 'supplierId:Supplier');
DROP TRIGGER tenant_guard ON "DeliveryNote";
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "DeliveryNote"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'documentId:Document', 'supplierId:Supplier', 'projectId:Project', 'confirmedByUserId:User', 'incomingInvoiceId:IncomingInvoice');
