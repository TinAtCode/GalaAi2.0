import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { writeAudit } from '../common/audit';
import { isValidDay } from '../common/time-zone';
import { recognizeDeliveryNote } from './recognize';
import { ConfirmDeliveryNoteDto, DeliveryNoteQueryDto } from './delivery-notes.dto';

interface Caller {
  companyId: string;
  userId: string;
}

const asDay = (day: string | null | undefined) => (day ? new Date(`${day}T00:00:00Z`) : null);

const include = {
  document: { select: { id: true, fileName: true, createdAt: true, ocrStatus: true, projectId: true } },
  supplier: { select: { id: true, name: true } },
  project: { select: { id: true, number: true, title: true } },
} satisfies Prisma.DeliveryNoteInclude;

// Lieferscheine: nach der Texterkennung schlägt GartenAI Lieferant und Projekt
// vor (Projektnummer, Lieferadresse, Kommission). Bestätigt das Büro, hängt
// der Lieferschein am Projekt (Dokumente, Nachkalkulation).
@Injectable()
export class DeliveryNotesService {
  private readonly logger = new Logger(DeliveryNotesService.name);

  constructor(private prisma: PrismaService) {}

  private view<T extends { noteDate: Date | null }>(note: T) {
    return { ...note, noteDate: note.noteDate ? note.noteDate.toISOString().slice(0, 10) : null };
  }

  // Vorschlag aus dem erkannten Text; bestätigte Lieferscheine bleiben unverändert
  async recognizeForDocument(companyId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({ where: { id: documentId, companyId } });
    if (!document) throw new NotFoundException('Dokument nicht gefunden.');
    const existing = await this.prisma.deliveryNote.findUnique({ where: { documentId } });
    if (existing?.status === 'confirmed') return this.get(companyId, existing.id);
    const [suppliers, projects] = await Promise.all([
      this.prisma.supplier.findMany({
        where: { companyId, active: true },
        select: { id: true, name: true, email: true, matchTerms: true },
      }),
      this.prisma.project.findMany({
        where: { companyId, status: { notIn: ['done', 'cancelled'] } },
        select: {
          id: true,
          number: true,
          title: true,
          property: {
            select: { street: true, postalCode: true, city: true, customer: { select: { name: true } } },
          },
        },
      }),
    ]);
    const result = recognizeDeliveryNote(
      document.ocrText ?? '',
      suppliers,
      projects.map((p) => ({
        id: p.id,
        number: p.number,
        title: p.title,
        customerName: p.property.customer.name,
        street: p.property.street,
        postalCode: p.property.postalCode,
        city: p.property.city,
      })),
    );
    // am Projekt hochgeladen: das Projekt steht schon fest
    const projectId = document.projectId ?? result.projectId;
    const data = {
      supplierId: result.supplierId,
      projectId,
      noteNumber: result.noteNumber,
      noteDate: asDay(result.noteDate),
      hints: {
        ...result.hints,
        ...(document.projectId ? { project: 'am Projekt hochgeladen' } : {}),
      },
    };
    const note = await this.prisma.$transaction(async (tx) => {
      if (document.documentType === 'other')
        await tx.document.update({ where: { id: documentId }, data: { documentType: 'delivery_note' } });
      return tx.deliveryNote.upsert({
        where: { documentId },
        create: { ...data, companyId, documentId },
        update: data,
      });
    });
    return this.get(companyId, note.id);
  }

  // aus der Texterkennung heraus: Fehler dürfen den OCR-Auftrag nicht scheitern lassen
  async recognizeSafely(companyId: string, documentId: string) {
    try {
      await this.recognizeForDocument(companyId, documentId);
    } catch (error) {
      this.logger.warn({ msg: 'Lieferschein nicht erkannt', documentId, error: String(error) });
    }
  }

  async list(companyId: string, query: DeliveryNoteQueryDto) {
    const notes = await this.prisma.deliveryNote.findMany({
      where: { companyId, ...(query.status ? { status: query.status } : {}) },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      include,
    });
    return notes.map((n) => this.view(n));
  }

  async forProject(companyId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, companyId } });
    if (!project) throw new NotFoundException('Projekt nicht gefunden.');
    const notes = await this.prisma.deliveryNote.findMany({
      where: { companyId, projectId },
      orderBy: [{ noteDate: 'desc' }, { createdAt: 'desc' }],
      include,
    });
    return notes.map((n) => this.view(n));
  }

  async get(companyId: string, id: string) {
    const note = await this.prisma.deliveryNote.findFirst({ where: { id, companyId }, include });
    if (!note) throw new NotFoundException('Lieferschein nicht gefunden.');
    return this.view(note);
  }

  async confirm(caller: Caller, id: string, dto: ConfirmDeliveryNoteDto) {
    const note = await this.prisma.deliveryNote.findFirst({ where: { id, companyId: caller.companyId } });
    if (!note) throw new NotFoundException('Lieferschein nicht gefunden.');
    if (dto.noteDate && !isValidDay(dto.noteDate)) throw new BadRequestException('Ungültiges Datum.');
    if (dto.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: dto.supplierId, companyId: caller.companyId },
      });
      if (!supplier) throw new BadRequestException('Lieferant nicht gefunden.');
    }
    if (dto.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: dto.projectId, companyId: caller.companyId },
      });
      if (!project) throw new BadRequestException('Projekt nicht gefunden.');
    }
    const projectId = dto.projectId === undefined ? note.projectId : dto.projectId;
    await this.prisma.$transaction(async (tx) => {
      await tx.deliveryNote.update({
        where: { id },
        data: {
          supplierId: dto.supplierId === undefined ? undefined : dto.supplierId,
          projectId,
          noteNumber: dto.noteNumber === undefined ? undefined : dto.noteNumber?.trim() || null,
          noteDate: dto.noteDate === undefined ? undefined : asDay(dto.noteDate),
          status: 'confirmed',
          confirmedByUserId: caller.userId,
          confirmedAt: new Date(),
        },
      });
      // der Lieferschein erscheint bei den Dokumenten des Projekts
      await tx.document.update({ where: { id: note.documentId }, data: { projectId } });
      await writeAudit(tx, {
        companyId: caller.companyId,
        userId: caller.userId,
        action: 'delivery_note_confirmed',
        entity: 'DeliveryNote',
        entityId: id,
        oldData: { supplierId: note.supplierId, projectId: note.projectId },
        newData: { supplierId: dto.supplierId ?? note.supplierId, projectId },
      });
    });
    return this.get(caller.companyId, id);
  }

  // Mail-Entwurf an den Lieferanten: Projektnummer, Lieferadresse und unsere
  // Kundennummer, damit Lieferscheine und Rechnungen richtig zugeordnet werden
  async supplierMail(caller: Caller, projectId: string, supplierId: string) {
    const [project, supplier, company, user] = await Promise.all([
      this.prisma.project.findFirst({
        where: { id: projectId, companyId: caller.companyId },
        include: { property: { include: { customer: { select: { name: true } } } } },
      }),
      this.prisma.supplier.findFirst({ where: { id: supplierId, companyId: caller.companyId } }),
      this.prisma.company.findUniqueOrThrow({ where: { id: caller.companyId } }),
      this.prisma.user.findFirst({
        where: { id: caller.userId, companyId: caller.companyId },
        select: { firstName: true, lastName: true, email: true },
      }),
    ]);
    if (!project) throw new NotFoundException('Projekt nicht gefunden.');
    if (!supplier) throw new NotFoundException('Lieferant nicht gefunden.');
    const number = project.number ?? '(noch ohne Nummer)';
    const address = [
      project.property.street,
      [project.property.postalCode, project.property.city].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(', ');
    const subject = `Projektnummer ${number} – ${project.title}`;
    const lines = [
      'Guten Tag,',
      '',
      `für unser Bauvorhaben „${project.title}“ bitten wir Sie, auf allen Lieferscheinen und Rechnungen unsere Projektnummer anzugeben:`,
      '',
      `Projektnummer: ${number}`,
      ...(address ? [`Lieferadresse: ${address}`] : []),
      `Kommission: ${project.property.customer.name}`,
      ...(supplier.customerNumber ? [`Unsere Kundennummer bei Ihnen: ${supplier.customerNumber}`] : []),
      '',
      'Vielen Dank!',
      '',
      'Mit freundlichen Grüßen',
      ...(user ? [`${user.firstName} ${user.lastName}`] : []),
      company.name,
    ];
    const body = lines.join('\n');
    const to = supplier.email ?? '';
    const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return { to, subject, body, mailto };
  }
}
