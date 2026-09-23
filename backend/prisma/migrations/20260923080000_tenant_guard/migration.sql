-- Mandantentrennung in der Datenbank: Eine Zeile darf nur auf Zeilen derselben
-- Firma verweisen (z.B. kein Angebot für das Projekt einer anderen Firma).
-- Die Services prüfen das bereits; die Trigger fangen jeden Weg ab, der daran
-- vorbeiführt (Codefehler, Skripte, direkte SQL-Zugriffe).
--
-- Aufruf: tenant_guard('<Quelle der eigenen Firma>', '<Spalte>:<Tabelle>', ...)
--   Quelle = "companyId" (Spalte der Zeile) oder "<Spalte>:<Tabelle>" für
--   Tabellen ohne eigene companyId (Firma des Elternobjekts).
-- Verweise, deren Ziel nicht existiert, prüft weiterhin der Fremdschlüssel.
CREATE FUNCTION tenant_guard() RETURNS trigger AS $$
DECLARE
  row_data jsonb := to_jsonb(NEW);
  own_company text;
  ref_company text;
  ref_id text;
  col text;
  tbl text;
  i int;
BEGIN
  IF position(':' in TG_ARGV[0]) = 0 THEN
    own_company := row_data ->> TG_ARGV[0];
  ELSE
    EXECUTE format('SELECT "companyId" FROM %I WHERE id = $1', split_part(TG_ARGV[0], ':', 2))
      INTO own_company USING row_data ->> split_part(TG_ARGV[0], ':', 1);
  END IF;

  FOR i IN 1 .. TG_NARGS - 1 LOOP
    col := split_part(TG_ARGV[i], ':', 1);
    tbl := split_part(TG_ARGV[i], ':', 2);
    ref_id := row_data ->> col;
    CONTINUE WHEN ref_id IS NULL;
    EXECUTE format('SELECT "companyId" FROM %I WHERE id = $1', tbl) INTO ref_company USING ref_id;
    IF ref_company IS NOT NULL AND ref_company IS DISTINCT FROM own_company THEN
      RAISE EXCEPTION 'Mandantenfremde Verknüpfung: %.% verweist auf % einer anderen Firma', TG_TABLE_NAME, col, tbl
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "Property"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'customerId:Customer');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "Project"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'propertyId:Property');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "Quote"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'projectId:Project');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "QuoteLineItem"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('quoteId:Quote', 'serviceId:Service');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "Order"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'projectId:Project', 'quoteId:Quote');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "Invoice"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'projectId:Project', 'orderId:Order', 'cancelsInvoiceId:Invoice');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "ServiceComponent"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('serviceId:Service', 'articleId:Article', 'machineId:Machine');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "Appointment"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'projectId:Project', 'assignedUserId:User');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "Employee"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'userId:User');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "TimeEntry"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'employeeId:Employee', 'projectId:Project');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "Document"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'projectId:Project', 'uploadedByUserId:User');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "ProjectMaterialUsage"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('companyId', 'projectId:Project', 'articleId:Article');
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON "UserRole"
FOR EACH ROW EXECUTE FUNCTION tenant_guard('userId:User', 'roleId:Role');
