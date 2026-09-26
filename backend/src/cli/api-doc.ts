// Erzeugt API.md (im Hauptordner) aus den Controllern: jede Schnittstelle mit
// Methode, Pfad, Anmeldung, nötigem Recht, eigenem Anfrage-Limit und dem
// Kommentar im Code. Grundlage für die Prüfung der Zugriffsrechte.
// Nicht von Hand ändern – neu erzeugen:  cd backend && npm run docs:api
// Der Unit-Test api-doc.spec.ts schlägt fehl, wenn die Datei veraltet ist.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import * as ts from 'typescript';
import { PERMISSIONS } from '../common/permissions';

const HTTP = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete']);

export interface Endpoint {
  method: string;
  path: string;
  auth: boolean;
  guards: string[];
  permissions: string[];
  throttle: string;
  note: string;
  handler: string;
}

export interface ControllerDoc {
  file: string;
  base: string;
  note: string;
  endpoints: Endpoint[];
}

function decorators(node: ts.Node): ts.Decorator[] {
  return (ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined)?.slice() ?? [];
}

function call(d: ts.Decorator) {
  if (!ts.isCallExpression(d.expression)) return null;
  const name = d.expression.expression.getText();
  return { name, args: d.expression.arguments };
}

function literal(node: ts.Expression | undefined): string {
  if (!node) return '';
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return node.getText();
}

// Kommentar direkt über einem Knoten (// oder /* */), ohne eslint-Hinweise
function comment(source: ts.SourceFile, node: ts.Node): string {
  const ranges = ts.getLeadingCommentRanges(source.text, node.getFullStart()) ?? [];
  return ranges
    .map((r) => source.text.slice(r.pos, r.end))
    .map((t) =>
      t
        .replace(/^\/\*+|\*+\/$/g, '')
        .split('\n')
        .map((l) => l.replace(/^\s*(\/\/+|\*)\s?/, '').trim())
        .join(' '),
    )
    .filter((t) => t && !t.startsWith('eslint'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const permissionKeys = PERMISSIONS as Record<string, string>;

function permissionsOf(decos: ts.Decorator[]): string[] {
  const out: string[] = [];
  for (const d of decos) {
    const c = call(d);
    if (c?.name !== 'RequirePermissions') continue;
    for (const a of c.args) {
      const name = a.getText().replace(/^PERMISSIONS\./, '');
      out.push(permissionKeys[name] ?? a.getText());
    }
  }
  return out;
}

function guardsOf(decos: ts.Decorator[]): string[] {
  return decos.flatMap((d) => {
    const c = call(d);
    return c?.name === 'UseGuards' ? c.args.map((a) => a.getText()) : [];
  });
}

function throttleOf(decos: ts.Decorator[]): string {
  for (const d of decos) {
    const c = call(d);
    if (c?.name === 'SkipThrottle') return 'ohne Limit';
    if (c?.name === 'Throttle') {
      const text = c.args[0]?.getText() ?? '';
      const limit = /limit:\s*([\w.]+)/.exec(text)?.[1] ?? '?';
      const ttl = /ttl:\s*([\d_]+)/.exec(text)?.[1] ?? '';
      return `${limit}${ttl ? ` je ${Number(ttl.replace(/_/g, '')) / 1000} s` : ''}`;
    }
  }
  return '';
}

export function parseControllers(file: string, text: string): ControllerDoc[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const docs: ControllerDoc[] = [];
  source.forEachChild((node) => {
    if (!ts.isClassDeclaration(node)) return;
    const decos = decorators(node);
    const controller = decos.map(call).find((c) => c?.name === 'Controller');
    if (!controller) return;
    const base = literal(controller.args[0] as ts.Expression | undefined);
    const classGuards = guardsOf(decos);
    const classPermissions = permissionsOf(decos);
    const classThrottle = throttleOf(decos);
    const endpoints: Endpoint[] = [];
    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const md = decorators(member);
      const http = md.map(call).find((c) => c && HTTP.has(c.name));
      if (!http) continue;
      const sub = literal(http.args[0] as ts.Expression | undefined);
      const guards = [...classGuards, ...guardsOf(md)];
      endpoints.push({
        method: http.name.toUpperCase(),
        path: `/${[base, sub].filter(Boolean).join('/')}`.replace(/\/+/g, '/'),
        auth: guards.some((g) => g.includes('JwtAuthGuard')),
        guards: guards.filter((g) => !['JwtAuthGuard', 'PermissionsGuard'].includes(g)),
        permissions: [...classPermissions, ...permissionsOf(md)],
        throttle: throttleOf(md) || classThrottle,
        note: comment(source, member),
        handler: member.name.getText(),
      });
    }
    docs.push({ file, base: `/${base}`, note: comment(source, node), endpoints });
  });
  return docs;
}

function controllerFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return controllerFiles(full);
      return name.endsWith('.controller.ts') ? [full] : [];
    });
}

export function collect(backendDir: string): ControllerDoc[] {
  const src = join(backendDir, 'src');
  return controllerFiles(src)
    .flatMap((f) => parseControllers(relative(backendDir, f), readFileSync(f, 'utf8')))
    .sort((a, b) => a.base.localeCompare(b.base) || a.file.localeCompare(b.file));
}

const cell = (text: string) => text.replace(/\|/g, '\\|');

export function render(controllers: ControllerDoc[]): string {
  const all = controllers.flatMap((c) => c.endpoints.map((e) => ({ ...e, file: c.file, classNote: c.note })));
  const open = all.filter((e) => !e.auth);
  const noPermission = all.filter((e) => e.auth && !e.permissions.length);
  const out: string[] = [
    '# Schnittstellen (API)',
    '',
    '> **Erzeugt** aus den Controllern (`backend/src/**/*.controller.ts`) – nicht von Hand ändern.',
    '> Neu erzeugen: `cd backend && npm run docs:api`. Der Unit-Test `api-doc.spec.ts` schlägt fehl, wenn',
    '> diese Datei nicht zum Code passt.',
    '',
    `${all.length} Schnittstellen in ${controllers.length} Controllern. Im Betrieb liegen sie unter \`/api\``,
    '(nginx leitet `/api/…` an das Backend weiter), z.B. `GET /api/customers`.',
    '',
    '## So wird der Zugriff geprüft',
    '',
    '1. **Anmeldung** (`JwtAuthGuard`, `src/auth/jwt-auth.guard.ts`): Sitzung im httpOnly-Cookie oder',
    '   Bearer-Token. Ändernde Anfragen mit Cookie brauchen zusätzlich `X-Requested-With` (CSRF-Schutz).',
    '   Ein Token gilt nur, solange die Token-Version des Nutzers passt (Abmelden, Passwortwechsel,',
    '   Deaktivieren machen alte Sitzungen ungültig).',
    '2. **Recht** (`PermissionsGuard`, `src/common/permissions.guard.ts`): Alle unter „Recht“ genannten',
    '   Rechte sind nötig. Die Rechte hängen an den Rollen des Nutzers (`DATENMODELL.md`).',
    '3. **Firma:** Jeder Service filtert mit der `companyId` des angemeldeten Nutzers; fremde IDs',
    '   ergeben 404. Zusätzlich Datenbank-Trigger und Prisma-Guard (siehe `README.md`, Architektur).',
    '4. **Feinere Regeln im Service**, z.B. Preise ohne Preisrecht werden aus der Antwort entfernt, eigene',
    '   Zeiten nur für das eigene Mitarbeiterprofil, Rechnungen nach dem Ausstellen unveränderlich.',
    '5. **Anfrage-Limit** global je Nutzer bzw. IP (`RATE_LIMIT`); Anmeldung zusätzlich je Konto und IP.',
    '   Abweichende Limits stehen in der Spalte „Limit“.',
    '',
    '## Ohne Anmeldung erreichbar',
    '',
    'Diese Schnittstellen prüfen keine Sitzung; was sie schützt, steht im Hinweis bzw. im Code.',
    '',
    '| Methode | Pfad | Limit | Hinweis | Datei |',
    '|---|---|---|---|---|',
    ...open.map(
      (e) =>
        `| ${e.method} | \`${e.path}\` | ${e.throttle} | ${cell([e.guards.length ? `Schutz: ${e.guards.join(', ')}` : '', e.note || e.classNote].filter(Boolean).join(' – '))} | \`${e.file}\` |`,
    ),
    '',
    '## Angemeldet, ohne besonderes Recht',
    '',
    'Jeder angemeldete Nutzer der Firma; Einschränkungen (z.B. nur eigene Daten) im Service.',
    '',
    '| Methode | Pfad | Hinweis |',
    '|---|---|---|',
    ...noPermission.map((e) => `| ${e.method} | \`${e.path}\` | ${cell(e.note)} |`),
    '',
    '## Alle Schnittstellen nach Bereich',
    '',
  ];
  for (const c of controllers) {
    out.push(`### \`${c.base}\``, '', `Datei: \`${c.file}\``, '');
    if (c.note) out.push(c.note, '');
    out.push('| Methode | Pfad | Anmeldung | Recht | Limit | Hinweis |', '|---|---|---|---|---|---|');
    for (const e of c.endpoints) {
      const guard = e.guards.length ? ` (${e.guards.join(', ')})` : '';
      out.push(
        `| ${e.method} | \`${e.path}\` | ${e.auth ? 'ja' : '**nein**'}${guard} | ${e.permissions.map((p) => `\`${p}\``).join(', ') || '–'} | ${e.throttle} | ${cell(e.note)} |`,
      );
    }
    out.push('');
  }
  return `${out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}

export const OUTPUT = join(__dirname, '..', '..', '..', 'API.md');

if (require.main === module) {
  writeFileSync(OUTPUT, render(collect(join(__dirname, '..', '..'))));
  console.log(`Geschrieben: ${OUTPUT}`);
}
