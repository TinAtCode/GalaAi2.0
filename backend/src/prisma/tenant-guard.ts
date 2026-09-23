// Zweite Sicherung der Mandantentrennung: Listen- und Massenabfragen auf
// Tabellen mit companyId müssen nach companyId filtern. Ein vergessener
// Filter scheitert damit sofort (500 + Test rot) statt Daten einer anderen
// Firma auszuliefern. Einzelzugriffe über die eindeutige id (findUnique,
// update, delete) sind erlaubt – sie folgen im Code auf eine Prüfung.

export const TENANT_MODELS = new Set([
  'User',
  'Role',
  'Customer',
  'Property',
  'Project',
  'Quote',
  'Order',
  'Article',
  'Service',
  'Supplier',
  'Machine',
  'Appointment',
  'Employee',
  'TimeEntry',
  'Document',
  'ProjectMaterialUsage',
  'AuditLog',
  'NumberSequence',
  'Invoice',
  'OcrJob',
  'InvoicePayment',
  'DunningNotice',
]);

const GUARDED_ACTIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

// companyId direkt oder in einem AND-Zweig – ein OR zählt nur, wenn jeder
// Zweig filtert.
export function filtersByCompany(where: unknown): boolean {
  if (!where || typeof where !== 'object') return false;
  const w = where as Record<string, unknown>;
  if (w.companyId !== undefined && w.companyId !== null) return true;
  const and = w.AND;
  if (Array.isArray(and) ? and.some(filtersByCompany) : filtersByCompany(and)) return true;
  return Array.isArray(w.OR) && w.OR.length > 0 && w.OR.every(filtersByCompany);
}

export class TenantFilterMissingError extends Error {
  constructor(model: string, action: string) {
    super(`Mandantentrennung: ${model}.${action} ohne companyId-Filter`);
    this.name = 'TenantFilterMissingError';
  }
}

export function assertTenantFilter(params: { model?: string; action: string; args?: { where?: unknown } }) {
  if (!params.model || !TENANT_MODELS.has(params.model) || !GUARDED_ACTIONS.has(params.action)) return;
  if (!filtersByCompany(params.args?.where)) {
    throw new TenantFilterMissingError(params.model, params.action);
  }
}
