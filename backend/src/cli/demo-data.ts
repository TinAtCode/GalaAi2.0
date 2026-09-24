import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '../common/permissions';
import { addCalendarDays, localDayString, localTimeInZone, DEFAULT_TIME_ZONE } from '../common/time-zone';
import { seedBase } from './base-seed';

// Demo für Vorführungen: ein Musterbetrieb mit drei Anmeldungen (Chef, Büro,
// Mitarbeiter), Kunden, Projekten, Terminen dieser Woche, Angeboten,
// Rechnungen (bezahlt und überfällig), einem Pflegevertrag und Nachrichten
// von der Baustelle. Alles über die echte API des laufenden Backends – die
// Daten sind so geprüft wie jede Eingabe in der App. Mehrfach aufrufbar:
// ist die Demo schon angelegt, passiert nichts.
//
// Aufruf (im Container): node dist/cli/demo-data.js [--api http://localhost:3000]
export const DEMO_PASSWORD = 'demo12345';
export const DEMO_LOGINS = [
  { role: 'Chef', email: 'admin@musterbetrieb.de' },
  { role: 'Büro', email: 'buero@musterbetrieb.de' },
  { role: 'Mitarbeiter', email: 'mitarbeiter@musterbetrieb.de' },
];
const MARKER = 'Hausverwaltung Rheinblick';

type Json = Record<string, unknown>;

class Api {
  private token = '';
  constructor(private base: string) {}

  async login(email: string, password: string) {
    const res = await this.call<{ accessToken: string }>('POST', '/auth/login', { email, password });
    this.token = res.accessToken;
    return this;
  }

  async call<T = Json>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }
  post<T = Json>(path: string, body: unknown = {}) {
    return this.call<T>('POST', path, body);
  }
}

async function waitForApi(base: string, seconds = 120) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const ok = await fetch(`${base}/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Backend unter ${base} antwortet nicht.`);
}

export async function createDemo(
  prisma: PrismaClient,
  base: string,
  log: (line: string) => void = console.log,
) {
  await seedBase(prisma);
  const company = await prisma.company.findUniqueOrThrow({ where: { id: 'demo-company-id' } });
  if (await prisma.customer.findFirst({ where: { companyId: company.id, name: MARKER } })) {
    // die Nachrichten entstehen zuletzt: fehlen sie, ist ein Lauf abgebrochen
    if (!(await prisma.projectMessage.count({ where: { companyId: company.id } }))) {
      throw new Error(
        'Die Demo wurde nur halb angelegt. Bitte zurücksetzen (ops/demo/reset) und neu starten.',
      );
    }
    log('Demo-Daten sind schon da – nichts zu tun.');
    return { created: false };
  }
  const tz = company.timeZone || DEFAULT_TIME_ZONE;
  const today = localDayString(new Date(), tz);
  const at = (dayOffset: number, hour: number, minute = 0) =>
    localTimeInZone(addCalendarDays(today, dayOffset), hour * 60 + minute, tz).toISOString();

  // Rolle „Büro“: alles außer Systemeinstellungen und Protokoll
  const permissions = await prisma.permission.findMany();
  const officeRole = await prisma.role.upsert({
    where: { companyId_name: { companyId: company.id, name: 'Büro' } },
    update: {},
    create: {
      companyId: company.id,
      name: 'Büro',
      permissions: {
        create: permissions
          .filter((p) => p.key !== PERMISSIONS.SYSTEM_SETTINGS_WRITE && p.key !== PERMISSIONS.AUDIT_READ)
          .map((p) => ({ permissionId: p.id })),
      },
    },
  });
  const workerRole = await prisma.role.findUniqueOrThrow({
    where: { companyId_name: { companyId: company.id, name: 'Mitarbeiter' } },
  });

  const chef = await new Api(base).login('admin@musterbetrieb.de', DEMO_PASSWORD);
  log('Firmendaten, Anmeldungen …');
  await chef.call('PATCH', '/company/settings', {
    street: 'Lindenallee 12',
    postalCode: '50667',
    city: 'Köln',
    taxNumber: '214/5678/1234',
    email: 'info@musterbetrieb.de',
    phone: '+49 221 1234567',
    iban: 'DE89370400440532013000',
  });
  const office = await chef.post<{ id: string }>('/users', {
    email: 'buero@musterbetrieb.de',
    firstName: 'Birgit',
    lastName: 'Büro',
    password: 'vorlaeufig-demo-1',
    roleIds: [officeRole.id],
    createEmployee: true,
  });
  const worker = await chef.post<{ id: string }>('/users', {
    email: 'mitarbeiter@musterbetrieb.de',
    firstName: 'Kai',
    lastName: 'Kelle',
    password: 'vorlaeufig-demo-2',
    roleIds: [workerRole.id],
    createEmployee: true,
  });
  // für die Vorführung ein Passwort für alle (wie beim Admin aus den Grunddaten)
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@musterbetrieb.de' } });
  await prisma.user.updateMany({
    where: { companyId: company.id, id: { in: [office.id, worker.id] } },
    data: { passwordHash: admin.passwordHash },
  });
  const me = await chef.call<{ id: string }>('GET', '/auth/me');

  log('Kunden und Projekte …');
  const project = async (customer: Json, label: string, street: string, title: string) => {
    const c = await chef.post<{ id: string }>('/customers', customer);
    const p = await chef.post<{ id: string }>('/properties', {
      customerId: c.id,
      label,
      street,
      postalCode: customer.postalCode,
      city: customer.city,
    });
    return (await chef.post<{ id: string }>('/projects', { propertyId: p.id, title })).id;
  };
  const garden = await project(
    {
      name: 'Familie Schneider',
      email: 'schneider@example.com',
      street: 'Am Rosenhang 4',
      postalCode: '50859',
      city: 'Köln',
    },
    'Wohnhaus',
    'Am Rosenhang 4',
    'Gartenneuanlage mit Natursteinmauer',
  );
  const drive = await project(
    {
      name: 'Dr. Weber',
      email: 'weber@example.com',
      street: 'Birkenweg 17',
      postalCode: '51069',
      city: 'Köln',
    },
    'Einfamilienhaus',
    'Birkenweg 17',
    'Einfahrt pflastern',
  );
  const pond = await project(
    {
      name: 'Café Seeblick',
      email: 'kontakt@cafe-seeblick.example',
      street: 'Uferstraße 2',
      postalCode: '50996',
      city: 'Köln',
      isBusiness: true,
    },
    'Außenbereich',
    'Uferstraße 2',
    'Terrasse und Teich',
  );
  const estate = await project(
    {
      name: MARKER,
      email: 'verwaltung@rheinblick.example',
      street: 'Rheinufer 30',
      postalCode: '50668',
      city: 'Köln',
      isBusiness: true,
    },
    'Wohnanlage Rheinufer 30–34',
    'Rheinufer 30',
    'Grünpflege Wohnanlage',
  );

  log('Angebote, Aufträge, Rechnungen …');
  const quote = async (projectId: string, lines: Json[]) => {
    const q = await chef.post<{ id: string }>('/quotes', { projectId, lineItems: lines });
    await chef.post(`/quotes/${q.id}/approve`);
    await chef.post(`/quotes/${q.id}/send`);
    return q.id;
  };
  const order = async (quoteId: string) => {
    await chef.post(`/quotes/${quoteId}/outcome`, { status: 'accepted' });
    return (await chef.post<{ id: string }>('/orders', { quoteId })).id;
  };
  const issue = async (orderId: string, kind: 'partial' | 'final', issueDate: string, percent?: number) => {
    const draft = await chef.post<{ id: string }>('/invoices/from-order', {
      orderId,
      kind,
      ...(percent ? { percent } : {}),
    });
    return chef.post<{ id: string; totalGross: string }>(`/invoices/${draft.id}/issue`, { issueDate });
  };
  const free = (
    description: string,
    unit: string,
    quantity: number,
    unitPrice: number,
    costPerUnit?: number,
  ) => ({
    description,
    unit,
    quantity,
    unitPrice,
    ...(costPerUnit !== undefined ? { costPerUnit } : {}),
  });

  // Schneider: Auftrag läuft, Abschlag bezahlt
  const gardenOrder = await order(
    await quote(garden, [
      free('Natursteinmauer Grauwacke, trocken gesetzt', 'm²', 18, 145, 82),
      free('Mutterboden liefern und einbauen', 'm³', 12, 48, 26),
      free('Staudenpflanzung inkl. Pflanzen', 'm²', 35, 38, 19),
      { serviceId: 'demo-service-id', quantity: 20 },
    ]),
  );
  const partial = await issue(gardenOrder, 'partial', addCalendarDays(today, -21), 40);
  await chef.post(`/invoices/${partial.id}/payments`, {
    amount: Number(partial.totalGross),
    paidOn: addCalendarDays(today, -9),
    method: 'bank',
  });

  // Weber: fertig abgerechnet, Zahlung überfällig (für offene Posten und Mahnung)
  const driveOrder = await order(
    await quote(drive, [
      free('Betonpflaster 20×10×8 verlegen inkl. Unterbau', 'm²', 64, 72, 41),
      free('Randeinfassung Tiefbord', 'm', 38, 24, 12),
    ]),
  );
  await issue(driveOrder, 'final', addCalendarDays(today, -45));

  // Café: Angebot verschickt, Antwort offen
  await quote(pond, [
    free('Holzterrasse Bangkirai', 'm²', 42, 165, 98),
    free('Teichanlage mit Folie und Bachlauf', 'psch', 1, 6800, 3900),
  ]);

  log('Pflegevertrag …');
  const contract = await chef.post<{ id: string }>('/contracts', {
    projectId: estate,
    title: 'Grünpflege Wohnanlage Rheinufer',
    startDate: addCalendarDays(today, -60),
    billingInterval: 'monthly',
    lines: [
      { description: 'Rasen- und Beetpflege pauschal', unit: 'psch', quantity: 1, unitPrice: 890 },
      { description: 'Heckenschnitt', unit: 'h', quantity: 6, unitPrice: 52 },
    ],
    tasks: [
      {
        title: 'Rasen mähen, Beete pflegen',
        everyWeeks: 1,
        seasonFrom: 3,
        seasonTo: 11,
        startMinutes: 7 * 60 + 30,
        durationMinutes: 180,
        nextDue: addCalendarDays(today, 1),
        assignedUserId: worker.id,
      },
    ],
  });
  await chef.post('/contracts/schedule', { until: addCalendarDays(today, 21) });
  await chef.post(`/contracts/${contract.id}/invoice`);

  log('Termine dieser Woche …');
  const appointment = (
    projectId: string,
    title: string,
    start: string,
    hours: number,
    assignedUserId?: string,
  ) =>
    chef.post('/appointments', {
      projectId,
      title,
      startTime: start,
      endTime: new Date(new Date(start).getTime() + hours * 3_600_000).toISOString(),
      ...(assignedUserId ? { assignedUserId } : {}),
    });
  await appointment(garden, 'Mauer setzen – 2. Abschnitt', at(0, 8), 4, worker.id);
  await appointment(drive, 'Abnahme mit Dr. Weber', at(0, 14), 1, worker.id);
  await appointment(garden, 'Pflanzen setzen', at(2, 8), 6, worker.id);
  await appointment(pond, 'Vor-Ort-Termin Terrasse', at(0, 15), 1, me.id);
  await appointment(pond, 'Aufmaß Teich', at(1, 9), 2);
  await appointment(garden, 'Material anliefern (Grauwacke)', at(3, 7), 1);

  // Büro nächste Woche im Urlaub (Plantafel: Abwesenheiten)
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const nextMonday = addCalendarDays(today, 7 - weekday);
  await chef.post('/absences', {
    userId: office.id,
    kind: 'vacation',
    startDate: nextMonday,
    endDate: addCalendarDays(nextMonday, 4),
  });

  log('Nachrichten von der Baustelle …');
  const onSite = await new Api(base).login('mitarbeiter@musterbetrieb.de', DEMO_PASSWORD);
  await onSite.post(`/site/projects/${garden}/messages`, {
    text: 'Fundament für den 2. Mauerabschnitt ist fertig. Brauchen morgen noch 2 t Grauwacke.',
  });
  await chef.post(`/site/projects/${garden}/messages`, { text: 'Ist bestellt, kommt Donnerstag um 7 Uhr.' });

  log('Fertig.');
  return { created: true, office: office.id, worker: worker.id };
}

async function main() {
  const args = process.argv.slice(2);
  const apiIndex = args.indexOf('--api');
  const base =
    (apiIndex >= 0 ? args[apiIndex + 1] : process.env.DEMO_API_URL) ||
    `http://localhost:${process.env.PORT ?? 3000}`;
  const prisma = new PrismaClient();
  try {
    await waitForApi(base);
    await createDemo(prisma, base);
    console.log('\nAnmeldungen (Passwort jeweils demo12345):');
    for (const login of DEMO_LOGINS) console.log(`  ${login.role.padEnd(12)} ${login.email}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: Error) => {
    console.error(`Demo-Daten fehlgeschlagen: ${error.message}`);
    process.exit(1);
  });
}
