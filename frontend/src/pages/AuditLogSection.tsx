import { useState } from 'react';
import { usePagedList } from '../api/usePagedList';
import { LoadMore } from '../layout/LoadMore';

interface AuditEntry {
  id: string;
  createdAt: string;
  action: string;
  entity: string;
  entityId: string | null;
  source: string;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  user: { id: string; name: string } | null;
}

const ACTION_LABELS: Record<string, string> = {
  article_update: 'Artikel geändert',
  machine_update: 'Maschine geändert',
  price_list_import_create: 'Preisliste: Artikel angelegt',
  price_list_import_update: 'Preisliste: Artikel geändert',
  quote_status: 'Angebotsstatus',
  order_status: 'Auftragsstatus',
  project_status: 'Projektstatus',
  invoice_issue: 'Rechnung ausgestellt',
  invoice_cancel: 'Rechnung storniert',
  invoice_send: 'Rechnung per E-Mail versendet',
  time_entry_approve: 'Zeiteintrag freigegeben',
  time_entry_correct: 'Zeiteintrag korrigiert',
  user_update: 'Nutzer geändert',
  user_password_reset: 'Passwort zurückgesetzt',
  user_role_assign: 'Rolle zugewiesen',
  user_role_remove: 'Rolle entzogen',
  role_permissions: 'Rechte einer Rolle geändert',
  ai_completion: 'KI-Anfrage',
  datev_export: 'DATEV-Export',
};

const FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Alle Bereiche' },
  { value: 'Quote', label: 'Angebote' },
  { value: 'Order', label: 'Aufträge' },
  { value: 'Invoice', label: 'Rechnungen' },
  { value: 'Project', label: 'Projekte' },
  { value: 'Article', label: 'Artikel' },
  { value: 'Machine', label: 'Maschinen' },
  { value: 'TimeEntry', label: 'Zeiterfassung' },
  { value: 'User', label: 'Nutzer' },
  { value: 'Role', label: 'Rollen' },
  { value: 'Company', label: 'Firma' },
];

const FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  purchasePrice: 'Einkaufspreis',
  salePrice: 'Verkaufspreis',
  hourlyRate: 'Stundensatz',
  name: 'Name',
  unit: 'Einheit',
  number: 'Nummer',
  cancellationNumber: 'Stornorechnung',
  reason: 'Grund',
  startTime: 'Beginn',
  endTime: 'Ende',
  breakMinutes: 'Pause (Min.)',
  active: 'Aktiv',
  firstName: 'Vorname',
  lastName: 'Nachname',
  permissions: 'Rechte',
  role: 'Rolle',
  count: 'Anzahl',
  articleNumbers: 'Artikelnummern',
  to: 'An',
  attachments: 'Anhänge',
  from: 'Von',
};

const VALUE_LABELS: Record<string, string> = {
  draft: 'Entwurf',
  approved: 'Freigegeben',
  sent: 'Versendet',
  accepted: 'Angenommen',
  rejected: 'Abgelehnt',
  expired: 'Abgelaufen',
  open: 'Offen',
  in_progress: 'In Arbeit',
  done: 'Fertig',
  cancelled: 'Storniert',
  completed: 'Abgeschlossen',
};

// Interne Schlüssel (roleId, prompt …) werden nicht angezeigt.
const HIDDEN_FIELDS = new Set(['roleId', 'prompt', 'providerName']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const show = (value: unknown): string => {
  if (value === null || value === undefined) return '–';
  if (typeof value === 'boolean') return value ? 'ja' : 'nein';
  if (Array.isArray(value)) return value.map(show).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  if (ISO_DATE.test(text)) return new Date(text).toLocaleString('de-DE');
  return VALUE_LABELS[text] ?? text;
};

// "Feld: alt → neu" für jedes geänderte Feld
function changes(entry: AuditEntry): string[] {
  const keys = new Set([...Object.keys(entry.oldData ?? {}), ...Object.keys(entry.newData ?? {})]);
  return [...keys]
    .filter((key) => !HIDDEN_FIELDS.has(key))
    .flatMap((key) => {
      const label = FIELD_LABELS[key] ?? key;
      const before = entry.oldData?.[key];
      const after = entry.newData?.[key];
      if (entry.oldData && entry.newData && key in entry.oldData) {
        if (show(before) === show(after)) return [];
        return [`${label}: ${show(before)} → ${show(after)}`];
      }
      return [`${label}: ${show(after ?? before)}`];
    });
}

// Wer hat wann was geändert – nur mit dem Recht audit.read.
export function AuditLogSection() {
  const [entity, setEntity] = useState('');
  const path = `/audit-log${entity ? `?entity=${entity}` : ''}`;
  const { items, total, error, hasMore, loadMore, loadingMore } = usePagedList<AuditEntry>(
    path,
    'Protokoll konnte nicht geladen werden.',
    50,
  );

  return (
    <section className="settings-section" data-testid="audit-log">
      <h3>Protokoll</h3>
      <p>Änderungen an Preisen, Status, Rechnungen, Zeiten, Nutzern und Rechten – neueste zuerst.</p>
      <label className="field" style={{ maxWidth: 260 }}>
        <span>Bereich</span>
        <select value={entity} onChange={(e) => setEntity(e.target.value)} data-testid="audit-filter">
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="field-error">{error}</p>}
      {items?.length === 0 && <p className="list-item-meta">Noch keine Einträge.</p>}
      {items?.map((entry) => (
        <div key={entry.id} className="list-item" data-testid="audit-entry">
          <div>
            <div className="list-item-name">{ACTION_LABELS[entry.action] ?? entry.action}</div>
            <div className="list-item-meta">
              {new Date(entry.createdAt).toLocaleString('de-DE')} ·{' '}
              {entry.user?.name ?? (entry.source === 'import' ? 'Import' : 'System')}
            </div>
            {changes(entry).map((line) => (
              <div key={line} className="list-item-meta" style={{ wordBreak: 'break-word' }}>
                {line}
              </div>
            ))}
          </div>
        </div>
      ))}
      {hasMore && (
        <LoadMore shown={items?.length ?? 0} total={total} onLoadMore={loadMore} loading={loadingMore} />
      )}
    </section>
  );
}
