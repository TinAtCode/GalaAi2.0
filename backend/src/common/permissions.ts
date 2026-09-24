// Zentrale Liste aller Permission-Keys. Diese Datei ist die "Single Source
// of Truth" – sowohl der Seed-Import (Permission-Tabelle) als auch die
// @RequirePermissions()-Decorators im Code referenzieren diese Konstanten,
// damit kein Tippfehler unbemerkt eine Rechteprüfung aushebeln kann.

export const PERMISSIONS = {
  CUSTOMER_READ: 'customer.read',
  CUSTOMER_WRITE: 'customer.write',
  CUSTOMER_DELETE: 'customer.delete',

  PRICE_PURCHASE_READ: 'price.purchase.read',
  PRICE_SALE_READ: 'price.sale.read',
  PRICE_MARGIN_READ: 'price.margin.read',

  QUOTE_CREATE: 'quote.create',
  QUOTE_APPROVE: 'quote.approve',

  ORDER_CREATE: 'order.create',
  INVOICE_CREATE: 'invoice.create',

  EMPLOYEE_DATA_READ: 'employee.data.read',

  DOCUMENT_READ: 'document.read',
  DOCUMENT_DELETE: 'document.delete',

  AI_USE: 'ai.use',
  AI_EXECUTE_ACTION: 'ai.execute_action',

  DATA_IMPORT: 'data.import',
  DATA_EXPORT: 'data.export',

  MASTERDATA_WRITE: 'masterdata.write',
  SYSTEM_SETTINGS_WRITE: 'system.settings.write',

  AUDIT_READ: 'audit.read',

  FINANCE_READ: 'finance.read',

  // Lagepläne am Projekt: ansehen (auch Mitarbeiter auf der Baustelle), zeichnen
  PLAN_READ: 'plan.read',
  PLAN_WRITE: 'plan.write',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Standardrolle "Buchhaltung": Finanzen, Rechnungen und Zahlungen, DATEV-Export,
// Kunden lesen, Dokumente sehen und hochladen (Belege; document.read umfasst
// auch Upload und Texterkennung) – keine Einkaufspreise, keine Nutzer- oder
// Systemverwaltung. Gleiche Liste in der Migration 20260924090000_finance.
export const BOOKKEEPING_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.FINANCE_READ,
  PERMISSIONS.INVOICE_CREATE,
  PERMISSIONS.DATA_EXPORT,
  PERMISSIONS.CUSTOMER_READ,
  PERMISSIONS.DOCUMENT_READ,
  PERMISSIONS.PRICE_SALE_READ,
];

// Standardrolle "Mitarbeiter": Kunden/Projekte und Lagepläne ansehen, KI nutzen –
// keine Preise. Lagepläne per Migration 20260924130000_site_plans nachgetragen.
export const EMPLOYEE_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.CUSTOMER_READ,
  PERMISSIONS.AI_USE,
  PERMISSIONS.PLAN_READ,
];
