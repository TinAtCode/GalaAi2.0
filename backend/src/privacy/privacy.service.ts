import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { writeAudit } from '../common/audit';
import { hashPassword } from '../auth/passwords';
import { invoiceClaims } from '../invoices/claims';

// Datenschutz (DSGVO): Auskunft (Art. 15) als JSON und Anonymisieren auf
// Anfrage (Art. 17) für Kunden und Nutzer/Mitarbeiter.
//
// Gelöscht wird nicht, sondern anonymisiert: Rechnungen, Zahlungen, Zeiten und
// das Protokoll müssen aufbewahrt werden (GoBD, Lohnunterlagen) und hängen an
// diesen Datensätzen. Ausgestellte Rechnungen behalten ihre eigene Kopie der
// Anschrift (buyerSnapshot) – die gehört zum Beleg und bleibt.
// Freie Texte (Projekttitel, Notizen, Nachrichten, Dokumente) werden nicht
// automatisch durchsucht; die Auskunft listet sie zur Prüfung von Hand.

const ANONYMIZED = '[anonymisiert]';
// Felder mit Personenbezug in alten Protokolleinträgen von Kunde und Objekt
const PERSONAL_KEYS = [
  'name',
  'email',
  'phone',
  'street',
  'postalCode',
  'city',
  'vatId',
  'buyerReference',
  'label',
  'firstName',
  'lastName',
  'note',
];

function redact(data: Prisma.JsonValue | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data ?? Prisma.JsonNull;
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      PERSONAL_KEYS.includes(key) && value !== null ? ANONYMIZED : value,
    ]),
  ) as Prisma.InputJsonValue;
}

const short = (id: string) => id.slice(0, 8);

// Nie passwordHash oder tokenVersion nach außen geben
function withoutSecrets<T extends { passwordHash: string; tokenVersion: number }>(user: T) {
  const copy: Partial<T> = { ...user };
  delete copy.passwordHash;
  delete copy.tokenVersion;
  return copy as Omit<T, 'passwordHash' | 'tokenVersion'>;
}

@Injectable()
export class PrivacyService {
  constructor(private prisma: PrismaService) {}

  private async customerOrThrow(companyId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id, companyId } });
    if (!customer) throw new NotFoundException('Kunde nicht gefunden.');
    return customer;
  }

  // Auskunft: alles, was zu einem Kunden gespeichert ist
  async customerExport(companyId: string, id: string) {
    const customer = await this.customerOrThrow(companyId, id);
    const properties = await this.prisma.property.findMany({ where: { companyId, customerId: id } });
    const projects = await this.prisma.project.findMany({
      where: { companyId, propertyId: { in: properties.map((p) => p.id) } },
    });
    const projectIds = projects.map((p) => p.id);
    const inProjects = { companyId, projectId: { in: projectIds } };
    const [quotes, invoices, documents, messages, contracts] = await Promise.all([
      this.prisma.quote.findMany({ where: inProjects, include: { lineItems: true } }),
      this.prisma.invoice.findMany({
        where: inProjects,
        include: { lineItems: true, payments: true, dunningNotices: true },
      }),
      this.prisma.document.findMany({
        where: inProjects,
        select: { id: true, projectId: true, fileName: true, documentType: true, createdAt: true },
      }),
      this.prisma.projectMessage.findMany({
        where: inProjects,
        select: { id: true, projectId: true, text: true, createdAt: true },
      }),
      this.prisma.maintenanceContract.findMany({ where: inProjects }),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      hinweis:
        'Auskunft nach Art. 15 DSGVO. Dokumente (Fotos, Belege) liegen als Dateien vor und werden bei Bedarf gesondert übergeben; freie Texte (Projekttitel, Nachrichten) bitte auf Angaben zu Dritten prüfen.',
      customer,
      properties,
      projects,
      maintenanceContracts: contracts,
      quotes,
      invoices,
      documents,
      projectMessages: messages,
    };
  }

  // Anonymisieren: Name, Kontakt und Anschriften entfernen; Belege bleiben
  async anonymizeCustomer(companyId: string, actingUserId: string, id: string) {
    const customer = await this.customerOrThrow(companyId, id);
    if (customer.anonymizedAt) throw new ConflictException('Der Kunde ist bereits anonymisiert.');
    const properties = await this.prisma.property.findMany({ where: { companyId, customerId: id } });
    const projectIds = (
      await this.prisma.project.findMany({
        where: { companyId, propertyId: { in: properties.map((p) => p.id) } },
        select: { id: true },
      })
    ).map((p) => p.id);
    // offene Forderungen und laufende Verträge brauchen Name und Anschrift noch
    const invoices = await this.prisma.invoice.findMany({
      where: { companyId, projectId: { in: projectIds }, status: 'issued', kind: { not: 'cancellation' } },
      include: { payments: true, dunningNotices: true, chargeWaivers: true },
    });
    const open = invoices.filter((i) => invoiceClaims(i).totalOpen.greaterThan(0));
    if (open.length)
      throw new ConflictException(
        `Noch offene Rechnungen (${open.map((i) => i.number).join(', ')}) – erst nach Zahlung oder Ausbuchung anonymisieren.`,
      );
    const contracts = await this.prisma.maintenanceContract.count({
      where: { companyId, projectId: { in: projectIds }, status: { not: 'ended' } },
    });
    if (contracts)
      throw new ConflictException(
        'Es gibt noch einen laufenden Pflegevertrag – erst beenden, dann anonymisieren.',
      );

    const label = `Anonymisiert ${short(id)}`;
    await this.prisma.$transaction(async (tx) => {
      await tx.customer.updateMany({
        where: { id, companyId },
        data: {
          name: label,
          email: null,
          phone: null,
          street: null,
          postalCode: null,
          city: null,
          vatId: null,
          buyerReference: null,
          anonymizedAt: new Date(),
        },
      });
      await tx.property.updateMany({
        where: { companyId, customerId: id },
        data: { label: 'Objekt', street: null, postalCode: null, city: null },
      });
      await this.redactAudit(tx, companyId, [
        { entity: 'Customer', ids: [id] },
        { entity: 'Property', ids: properties.map((p) => p.id) },
      ]);
      await writeAudit(tx, {
        companyId,
        userId: actingUserId,
        action: 'customer_anonymize',
        entity: 'Customer',
        entityId: id,
      });
    });
    return this.customerOrThrow(companyId, id);
  }

  private async userOrThrow(companyId: string, id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, companyId }, include: { employee: true } });
    if (!user) throw new NotFoundException('Nutzer nicht gefunden.');
    return user;
  }

  // Auskunft: alles, was zu einem Nutzer bzw. Mitarbeiter gespeichert ist
  async userExport(companyId: string, id: string) {
    const user = await this.userOrThrow(companyId, id);
    const [roles, timeEntries, absences, appointments, messages, calendarEvents, pushDevices, audit] =
      await Promise.all([
        this.prisma.userRole.findMany({
          where: { userId: id, role: { companyId } },
          include: { role: true },
        }),
        user.employee
          ? this.prisma.timeEntry.findMany({ where: { companyId, employeeId: user.employee.id } })
          : Promise.resolve([]),
        this.prisma.absence.findMany({ where: { companyId, userId: id } }),
        this.prisma.appointment.findMany({
          where: { companyId, assignedUserId: id },
          select: { id: true, title: true, startTime: true, endTime: true, projectId: true },
        }),
        this.prisma.projectMessage.findMany({
          where: { companyId, authorUserId: id },
          select: { id: true, projectId: true, text: true, createdAt: true },
        }),
        this.prisma.calendarEvent.findMany({ where: { companyId, ownerUserId: id } }),
        this.prisma.pushSubscription.findMany({
          where: { companyId, userId: id },
          select: { id: true, userAgent: true, createdAt: true },
        }),
        this.prisma.auditLog.findMany({
          where: { companyId, userId: id },
          select: { action: true, entity: true, entityId: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        }),
      ]);
    return {
      exportedAt: new Date().toISOString(),
      hinweis: 'Auskunft nach Art. 15 DSGVO. Das Passwort ist nur als nicht umkehrbarer Hash gespeichert.',
      user: withoutSecrets(user),
      roles: roles.map((r) => r.role.name),
      timeEntries,
      absences,
      appointments,
      calendarEvents,
      projectMessages: messages,
      pushDevices,
      actions: audit,
    };
  }

  // Anonymisieren: Anmeldung unmöglich, Name und E-Mail entfernt; Zeiten und
  // Protokoll bleiben (Aufbewahrung), zeigen dann auf die anonyme Person
  async anonymizeUser(companyId: string, actingUserId: string, id: string) {
    const user = await this.userOrThrow(companyId, id);
    if (id === actingUserId) throw new BadRequestException('Du kannst dich nicht selbst anonymisieren.');
    if (user.anonymizedAt) throw new ConflictException('Der Nutzer ist bereits anonymisiert.');
    const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
    await this.prisma.$transaction(async (tx) => {
      await tx.user.updateMany({
        where: { id, companyId },
        data: {
          email: `anonymisiert-${id}@example.invalid`,
          firstName: 'Anonymisiert',
          lastName: short(id),
          passwordHash,
          active: false,
          tokenVersion: { increment: 1 },
          anonymizedAt: new Date(),
        },
      });
      if (user.employee)
        await tx.employee.updateMany({
          where: { id: user.employee.id, companyId },
          data: { firstName: 'Anonymisiert', lastName: short(user.employee.id), active: false },
        });
      await tx.pushSubscription.deleteMany({ where: { companyId, userId: id } });
      await tx.absence.updateMany({ where: { companyId, userId: id }, data: { note: null } });
      await this.redactAudit(tx, companyId, [
        { entity: 'User', ids: [id] },
        ...(user.employee ? [{ entity: 'Employee', ids: [user.employee.id] }] : []),
      ]);
      await writeAudit(tx, {
        companyId,
        userId: actingUserId,
        action: 'user_anonymize',
        entity: 'User',
        entityId: id,
      });
    });
    return withoutSecrets(await this.userOrThrow(companyId, id));
  }

  // Personenbezogene Werte in alten Protokolleinträgen dieser Datensätze ersetzen;
  // wer wann was geändert hat, bleibt erhalten
  private async redactAudit(
    tx: Prisma.TransactionClient,
    companyId: string,
    targets: { entity: string; ids: string[] }[],
  ) {
    for (const { entity, ids } of targets) {
      if (!ids.length) continue;
      const entries = await tx.auditLog.findMany({ where: { companyId, entity, entityId: { in: ids } } });
      for (const entry of entries)
        await tx.auditLog.updateMany({
          where: { id: entry.id, companyId },
          data: { oldData: redact(entry.oldData), newData: redact(entry.newData) },
        });
    }
  }
}
