// Erzeugt DATENMODELL.md (im Hauptordner) aus prisma/schema.prisma und den
// Migrationen: Bereiche mit ER-Diagramm, jede Tabelle mit Feldern, Kommentaren,
// Beziehungen und Löschregeln, die Mandanten-Schutzregeln (tenant_guard) und
// alle Aufzählungen. Nicht von Hand ändern – neu erzeugen:
//   cd backend && npm run docs:datenmodell
// Der Unit-Test datenmodell.spec.ts schlägt fehl, wenn die Datei veraltet ist
// oder eine neue Tabelle keinem Bereich zugeordnet wurde.
import { Prisma } from '@prisma/client';
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

type Field = Prisma.DMMF.Field;
type Model = Prisma.DMMF.Model;
type Enum = Prisma.DMMF.DatamodelEnum;

// Fachliche Bereiche – jede neue Tabelle hier einem Bereich zuordnen
export const AREAS: { title: string; intro: string; models: string[] }[] = [
  {
    title: 'Firma, Benutzer und Rechte',
    intro:
      'Die Firma (Mandant) ist die Wurzel aller Daten. Nutzer haben Rollen, Rollen haben Rechte (feste Schlüssel aus src/common/permissions.ts).',
    models: ['Company', 'User', 'Role', 'UserRole', 'Permission', 'RolePermission', 'PushSubscription'],
  },
  {
    title: 'Kunden und Projekte',
    intro: 'Kunde → Objekt (Adresse) → Projekt. Fast alles Weitere hängt an einem Projekt.',
    models: ['Customer', 'Property', 'Project', 'ProjectMessage', 'ProjectMessageRead'],
  },
  {
    title: 'Stammdaten',
    intro:
      'Artikel, Leistungen mit Rezeptur (ServiceComponent: Artikel oder Maschine je Einheit), Lieferanten, Maschinen, Einheiten.',
    models: ['Article', 'Service', 'ServiceComponent', 'Supplier', 'Machine', 'UnitSetting', 'ImportSession'],
  },
  {
    title: 'Angebote und Aufträge',
    intro:
      'Angebotspositionen speichern Preise als Kopie (Snapshot); ein Auftrag entsteht aus genau einem angenommenen Angebot.',
    models: ['Quote', 'QuoteLineItem', 'Order'],
  },
  {
    title: 'Pflege- und Wartungsverträge',
    intro: 'Wiederkehrende Einsätze werden zu Terminen, die Vergütung je Zeitraum zu Rechnungen.',
    models: ['MaintenanceContract', 'ContractLine', 'ContractTask'],
  },
  {
    title: 'Planung, Team und Zeiten',
    intro:
      'Termine, Abwesenheiten, Kalender, Mitarbeiter (getrennt von Nutzern), Zeiten und Materialverbrauch.',
    models: ['Appointment', 'Absence', 'CalendarEvent', 'Employee', 'TimeEntry', 'ProjectMaterialUsage'],
  },
  {
    title: 'Baustelle: Lagepläne, Bautagebuch, Checklisten',
    intro: 'Alles, was auf der Baustelle am Projekt entsteht.',
    models: [
      'SitePlan',
      'PlanServiceMapping',
      'SiteDiaryEntry',
      'ChecklistTemplate',
      'Checklist',
      'ChecklistItem',
      'ChecklistComment',
    ],
  },
  {
    title: 'Rechnungen, Zahlungen, Mahnungen',
    intro: 'Ab „issued“ ist eine Rechnung unveränderlich; Korrekturen laufen über Storno bzw. neue Belege.',
    models: [
      'Invoice',
      'InvoiceLineItem',
      'InvoicePayment',
      'DunningNotice',
      'InvoiceChargeWaiver',
      'InvoiceFile',
      'NumberSequence',
    ],
  },
  {
    title: 'Bank und Finanzen',
    intro:
      'Kontoauszüge, Kontostände, Ausgabenkategorien mit Regeln, Fixkosten, Versicherungen und Verträge.',
    models: [
      'BankTransaction',
      'BankBalance',
      'ExpenseCategory',
      'CategoryRule',
      'RecurringPayment',
      'BusinessContract',
    ],
  },
  {
    title: 'Einkauf',
    intro: 'Eingangsrechnungen und Lieferscheine; beide lassen sich einem Projekt und einander zuordnen.',
    models: ['IncomingInvoice', 'DeliveryNote'],
  },
  {
    title: 'Dokumente und Texterkennung',
    intro: 'Metadaten der Dateien (Inhalt im Volume bzw. S3) und die Warteschlange der Texterkennung.',
    models: ['Document', 'OcrJob', 'OcrSlot'],
  },
  {
    title: 'Geräte und Fahrzeuge',
    intro: 'Geräte mit Schäden, Wartungsplänen, Wartungsprotokoll und Inventur.',
    models: [
      'Equipment',
      'EquipmentDamage',
      'EquipmentMaintenance',
      'EquipmentMaintenanceLog',
      'InventoryCount',
      'InventoryCountItem',
    ],
  },
  {
    title: 'KI',
    intro: 'KI-Anbieter je Firma (Schlüssel verschlüsselt) und welche Aufgabe welcher Anbieter übernimmt.',
    models: ['AiProviderConfig', 'AiTaskAssignment'],
  },
  {
    title: 'Protokoll und Betrieb',
    intro: 'Audit-Log je Firma; firmenübergreifende Tabellen des Servers (Geheimnisse, Messwerte).',
    models: ['AuditLog', 'AppSecret', 'MetricSample'],
  },
];

interface Comments {
  models: Map<string, string>;
  fields: Map<string, string>; // "Model.feld" → Kommentar
}

// Kommentare (//) aus dem Schema: der Block direkt über einem model/enum und
// je Feld die Zeilen darüber plus der Kommentar am Zeilenende
export function schemaComments(schema: string): Comments {
  const models = new Map<string, string>();
  const fields = new Map<string, string>();
  let pending: string[] = [];
  let current: string | null = null;
  const clean = (lines: string[]) =>
    lines
      .map((l) => l.trim())
      .filter((l) => l && !/^─+$/.test(l))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  for (const raw of schema.split('\n')) {
    const line = raw.trim();
    const block = /^(model|enum)\s+(\w+)\s*\{/.exec(line);
    if (block) {
      current = block[2];
      if (pending.length) models.set(current, clean(pending));
      pending = [];
      continue;
    }
    if (line === '}') {
      current = null;
      pending = [];
      continue;
    }
    if (line.startsWith('//')) {
      pending.push(line.replace(/^\/+\s?/, ''));
      continue;
    }
    if (!line) {
      if (!current) pending = [];
      continue;
    }
    if (current) {
      const name = /^(\w+)\s/.exec(line)?.[1];
      const trailing = /\/\/\s?(.*)$/.exec(line)?.[1];
      const text = clean([...pending, ...(trailing ? [trailing] : [])]);
      if (name && !line.startsWith('@@') && text) fields.set(`${current}.${name}`, text);
      pending = [];
    }
  }
  return { models, fields };
}

// Mandanten-Schutz: tenant_guard-Trigger aus den Migrationen (der zuletzt
// angelegte je Tabelle gilt)
export function tenantGuards(migrations: string[]): Map<string, string[]> {
  const guards = new Map<string, string[]>();
  const trigger = /CREATE\s+TRIGGER\s+\S+[\s\S]*?ON\s+"(\w+)"[\s\S]*?tenant_guard\(([^)]*)\)/gi;
  for (const sql of migrations) {
    for (const match of sql.matchAll(trigger)) {
      const args = match[2]
        .split(',')
        .map((a) => a.trim().replace(/^'|'$/g, ''))
        .slice(1);
      guards.set(match[1], args);
    }
  }
  return guards;
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function typeOf(field: Field) {
  let type = field.type;
  if (field.kind === 'enum') type = `[${field.type}](#enum-${field.type.toLowerCase()})`;
  if (field.kind === 'object') type = `[${field.type}](#${field.type.toLowerCase()})`;
  return `${type}${field.isList ? '[]' : ''}${field.isRequired || field.isList ? '' : '?'}`;
}

function defaultOf(field: Field) {
  if (!field.hasDefaultValue) return field.isUpdatedAt ? 'bei Änderung' : '';
  const d = field.default as unknown;
  if (d && typeof d === 'object' && 'name' in d) {
    const name = (d as { name: string }).name;
    return name.startsWith('uuid') ? 'UUID' : name === 'now' ? 'jetzt' : name;
  }
  return Array.isArray(d) ? `[${d.join(', ')}]` : String(d);
}

function mermaid(area: (typeof AREAS)[number], models: Map<string, Model>) {
  const lines = ['```mermaid', 'erDiagram'];
  const seen = new Set<string>();
  for (const name of area.models) {
    const model = models.get(name);
    if (!model) continue;
    for (const f of model.fields) {
      if (f.kind !== 'object' || !f.relationFromFields?.length || f.type === 'Company') continue;
      const key = `${name}-${f.type}-${f.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const fk = model.fields.find((x) => x.name === f.relationFromFields![0]);
      const one = fk?.isUnique || (model.uniqueFields ?? []).some((u) => u.length === 1 && u[0] === fk?.name);
      const left = one ? '|o' : '}o';
      const right = f.isRequired ? '||' : 'o|';
      lines.push(`  ${name} ${left}--${right} ${f.type} : "${f.name}"`);
    }
  }
  if (lines.length === 2) return '';
  lines.push('```');
  return lines.join('\n');
}

export function render(schema: string, migrations: string[]): string {
  const dmmf = Prisma.dmmf.datamodel;
  const models = new Map(dmmf.models.map((m) => [m.name, m as Model]));
  const enums = new Map(dmmf.enums.map((e) => [e.name, e as Enum]));
  const comments = schemaComments(schema);
  const guards = tenantGuards(migrations);
  const assigned = new Set(AREAS.flatMap((a) => a.models));
  const missing = [...models.keys()].filter((m) => !assigned.has(m));
  if (missing.length)
    throw new Error(
      `Tabellen ohne Bereich (in src/cli/datenmodell.ts AREAS eintragen): ${missing.join(', ')}`,
    );
  const unknown = [...assigned].filter((m) => !models.has(m));
  if (unknown.length) throw new Error(`Unbekannte Tabellen in AREAS: ${unknown.join(', ')}`);

  // wer zeigt auf wen (für „Verwendet von“)
  const incoming = new Map<string, string[]>();
  for (const model of models.values())
    for (const f of model.fields)
      if (f.kind === 'object' && f.relationFromFields?.length)
        incoming.set(f.type, [
          ...(incoming.get(f.type) ?? []),
          `${model.name}.${f.relationFromFields.join(', ')}`,
        ]);

  const out: string[] = [];
  out.push(
    '# Datenmodell',
    '',
    '> **Erzeugt** aus `backend/prisma/schema.prisma` und den Migrationen – nicht von Hand ändern.',
    '> Neu erzeugen: `cd backend && npm run docs:datenmodell`. Der Unit-Test `datenmodell.spec.ts`',
    '> schlägt fehl, wenn diese Datei nicht zum Schema passt.',
    '',
    `${models.size} Tabellen, ${enums.size} Aufzählungen, PostgreSQL 16 über Prisma 5.`,
    '',
    '## Lesehilfe',
    '',
    '- **Schlüssel:** Jede Tabelle hat eine `id` (UUID, Text). Fremdschlüssel heißen `<name>Id` und zeigen auf die `id` der genannten Tabelle.',
    '- **Mandant:** Fast jede Tabelle hat `companyId` (→ `Company`). Alle Abfragen filtern darüber; der',
    '  Prisma-Guard (`src/prisma/tenant-guard.ts`) lehnt Listen- und Massenabfragen ohne diesen Filter ab.',
    '- **Mandanten-Schutz in der Datenbank:** Wo angegeben, prüft ein Trigger (`tenant_guard`) beim Schreiben, dass',
    '  die verknüpften Datensätze zur selben Firma gehören – auch bei direktem SQL.',
    '- **Beziehungen:** `n:1` = viele Datensätze dieser Tabelle zeigen auf einen; `1:1` = höchstens einer. „Beim Löschen“ ist',
    '  die Regel der Datenbank (`Cascade` löscht mit, `SetNull` leert den Verweis, `Restrict` verhindert das Löschen).',
    '- **Geld** steht als `Decimal` (exakt), **Zeitpunkte** als `DateTime` in UTC; Tagesgrenzen rechnet die App in',
    '  `Company.timeZone` (Standard `Europe/Berlin`). **JSON**-Felder enthalten strukturierte Daten der App (z.B. Lageplan-Objekte).',
    '- **Snapshots:** Angebots- und Rechnungspositionen speichern Texte und Preise als Kopie; spätere Änderungen an',
    '  Stammdaten ändern bestehende Belege nicht.',
    '',
    '## Typische Wege durch die Daten',
    '',
    '| Frage | Weg |',
    '|---|---|',
    '| Zu welchem Kunden gehört ein Projekt? | `Project.propertyId` → `Property.customerId` → `Customer` |',
    '| Positionen eines Angebots | `QuoteLineItem.quoteId` → `Quote`; Leistung optional über `QuoteLineItem.serviceId` |',
    '| Auftrag zum Angebot | `Order.quoteId` (höchstens ein Auftrag je Angebot) |',
    '| Rechnungen eines Projekts, Zahlungen, Mahnungen | `Invoice.projectId`; `InvoicePayment.invoiceId`; `DunningNotice.invoiceId` |',
    '| Schlussrechnung und ihre Abschläge, Storno und Original | über die Rechnungsfelder in [Invoice](#invoice) |',
    '| Zahlung aus dem Kontoauszug | `BankTransaction` → Zuordnung zu Rechnung bzw. Eingangsrechnung (Felder dort) |',
    '| Einkauf am Projekt | `IncomingInvoice.projectId`, `DeliveryNote.projectId`, `DeliveryNote.incomingInvoiceId` |',
    '| Zeiten und Material am Projekt (Nachkalkulation) | `TimeEntry.projectId` → `Employee`; `ProjectMaterialUsage.projectId` → `Article` |',
    '| Rezeptur einer Leistung | `ServiceComponent.serviceId` → `Article` bzw. `Machine` |',
    '| Wer hat was geändert? | `AuditLog` (Firma, Nutzer, Aktion, Objekt, alte/neue Werte) |',
    '| Rechte eines Nutzers | `UserRole` → `Role` → `RolePermission` → `Permission.key` |',
    '',
    '## Bereiche',
    '',
    ...AREAS.map((a) => `- [${a.title}](#${slug(a.title)}) – ${a.models.length} Tabellen`),
    '- [Aufzählungen](#aufzählungen)',
    '',
  );

  for (const area of AREAS) {
    out.push(`## ${area.title}`, '', area.intro, '');
    const diagram = mermaid(area, models);
    if (diagram) out.push(diagram, '');
    for (const name of area.models) {
      const model = models.get(name)!;
      out.push(`### ${name}`, '');
      const text = comments.models.get(name);
      if (text) out.push(text, '');
      out.push('| Feld | Typ | Standard | Bedeutung |', '|---|---|---|---|');
      for (const f of model.fields) {
        if (f.kind === 'object') continue;
        const marks = [f.isId ? 'Schlüssel' : '', f.isUnique ? 'eindeutig' : ''].filter(Boolean).join(', ');
        const note = [marks, comments.fields.get(`${name}.${f.name}`) ?? ''].filter(Boolean).join(' – ');
        out.push(`| \`${f.name}\` | ${typeOf(f)} | ${cell(defaultOf(f))} | ${cell(note)} |`);
      }
      out.push('');
      const relations = model.fields.filter((f) => f.kind === 'object' && f.relationFromFields?.length);
      if (relations.length) {
        out.push('**Verweist auf**', '');
        for (const f of relations) {
          const fk = f.relationFromFields!.join(', ');
          const fkField = model.fields.find((x) => x.name === f.relationFromFields![0]);
          const oneToOne =
            fkField?.isUnique ||
            (model.uniqueFields ?? []).some((u) => u.length === 1 && u[0] === fkField?.name);
          const onDelete = f.relationOnDelete ? `, beim Löschen: ${f.relationOnDelete}` : '';
          out.push(
            `- \`${fk}\` → [${f.type}](#${f.type.toLowerCase()}) (${oneToOne ? '1:1' : 'n:1'}, ${f.isRequired ? 'Pflicht' : 'optional'}${onDelete})`,
          );
        }
        out.push('');
      }
      const usedBy = incoming.get(name);
      if (usedBy?.length) out.push(`**Verwendet von:** ${usedBy.map((u) => `\`${u}\``).join(', ')}`, '');
      const unique = (model.uniqueFields ?? []).filter((u) => u.length > 1);
      if (unique.length) out.push(`**Eindeutig:** ${unique.map((u) => `(${u.join(', ')})`).join(', ')}`, '');
      const guard = guards.get(name);
      if (guard)
        out.push(
          `**Mandanten-Schutz (Trigger):** ${guard.length ? guard.map((g) => '`' + g.replace(':', '` → ')).join(', ') : 'nur companyId'} gehören zur selben Firma`,
          '',
        );
    }
  }

  out.push('## Aufzählungen', '');
  for (const e of [...enums.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    out.push(`### Enum ${e.name}`, '');
    const text = comments.models.get(e.name);
    if (text) out.push(text, '');
    out.push(e.values.map((v) => `\`${v.name}\``).join(' · '), '');
  }
  return `${out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}

function slug(title: string) {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function load(backendDir: string) {
  const schema = readFileSync(join(backendDir, 'prisma', 'schema.prisma'), 'utf8');
  const dir = join(backendDir, 'prisma', 'migrations');
  const migrations = readdirSync(dir)
    .filter((d) => /^\d/.test(d))
    .sort()
    .map((d) => readFileSync(join(dir, d, 'migration.sql'), 'utf8'));
  return { schema, migrations };
}

export const OUTPUT = join(__dirname, '..', '..', '..', 'DATENMODELL.md');

if (require.main === module) {
  const { schema, migrations } = load(join(__dirname, '..', '..'));
  writeFileSync(OUTPUT, render(schema, migrations));
  console.log(`Geschrieben: ${OUTPUT}`);
}
