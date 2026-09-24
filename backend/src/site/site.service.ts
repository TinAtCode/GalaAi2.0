import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FILE_STORAGE, FileStorage } from '../documents/storage/file-storage.interface';
import { dayRangeInZone } from '../common/time-zone';

type UploadedFile = { originalname: string; buffer: Buffer; mimetype: string };

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MESSAGE_PAGE = 200;

const messageSelect = {
  id: true,
  text: true,
  documentId: true,
  clientId: true,
  createdAt: true,
  author: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ProjectMessageSelect;

// Baustelle: der eigene Tag (Termine, laufende Zeit, ungelesene Nachrichten),
// Nachrichten und Fotos je Projekt zwischen Büro und Baustelle. Recht
// site.use; alle Nutzer mit dem Recht sehen die Projekte ihrer Firma.
@Injectable()
export class SiteService {
  constructor(
    private prisma: PrismaService,
    @Inject(FILE_STORAGE) private storage: FileStorage,
  ) {}

  private async project(companyId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
      select: { id: true, title: true },
    });
    if (!project) throw new NotFoundException('Projekt nicht gefunden.');
    return project;
  }

  // Termine des Tages mit Adresse fürs Navi, laufende Zeiterfassung, ungelesene Nachrichten
  async today(companyId: string, userId: string, date: Date) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const { start, end } = dayRangeInZone(date, company.timeZone);
    const [appointments, running, unread] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          companyId,
          assignedUserId: userId,
          startTime: { gte: start, lt: end },
          status: { not: 'cancelled' },
        },
        orderBy: { startTime: 'asc' },
        select: {
          id: true,
          title: true,
          startTime: true,
          endTime: true,
          status: true,
          notes: true,
          project: {
            select: {
              id: true,
              title: true,
              property: {
                select: {
                  label: true,
                  street: true,
                  postalCode: true,
                  city: true,
                  customer: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.timeEntry.findFirst({
        where: { companyId, status: 'open', employee: { userId } },
        select: { id: true, startTime: true, projectId: true, activity: true },
      }),
      this.unread(companyId, userId),
    ]);
    return {
      appointments: appointments.map((a) => {
        const { property } = a.project;
        const address = [property.street, [property.postalCode, property.city].filter(Boolean).join(' ')]
          .filter(Boolean)
          .join(', ');
        return {
          id: a.id,
          title: a.title,
          startTime: a.startTime,
          endTime: a.endTime,
          status: a.status,
          notes: a.notes,
          projectId: a.project.id,
          projectTitle: a.project.title,
          customer: property.customer.name,
          place: property.label,
          address,
          unread: unread.find((u) => u.projectId === a.project.id)?.count ?? 0,
        };
      }),
      running,
      unread,
    };
  }

  // Eigenen Termin als erledigt melden (ohne customer.write)
  async markDone(companyId: string, userId: string, appointmentId: string) {
    const { count } = await this.prisma.appointment.updateMany({
      where: { id: appointmentId, companyId, assignedUserId: userId, status: 'planned' },
      data: { status: 'done' },
    });
    if (!count) throw new NotFoundException('Kein offener eigener Termin.');
    return { done: true };
  }

  // Projekte mit Nachrichten anderer, die neuer sind als das eigene Lesen
  async unread(companyId: string, userId: string) {
    const rows = await this.prisma.$queryRaw<{ projectId: string; title: string; count: bigint }[]>`
      SELECT m."projectId", p.title, COUNT(*) AS count
      FROM "ProjectMessage" m
      JOIN "Project" p ON p.id = m."projectId"
      LEFT JOIN "ProjectMessageRead" r ON r."projectId" = m."projectId" AND r."userId" = ${userId}
      WHERE m."companyId" = ${companyId} AND m."authorUserId" <> ${userId}
        AND (r."lastReadAt" IS NULL OR m."createdAt" > r."lastReadAt")
      GROUP BY m."projectId", p.title
      ORDER BY MAX(m."createdAt") DESC`;
    return rows.map((r) => ({ projectId: r.projectId, projectTitle: r.title, count: Number(r.count) }));
  }

  // Letzte Nachrichten (älteste zuerst); mit `before` weiter zurück blättern
  async messages(companyId: string, projectId: string, before?: string) {
    const project = await this.project(companyId, projectId);
    const list = await this.prisma.projectMessage.findMany({
      where: { companyId, projectId, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: MESSAGE_PAGE,
      select: messageSelect,
    });
    return { project, messages: list.reverse(), more: list.length === MESSAGE_PAGE };
  }

  async markRead(companyId: string, userId: string, projectId: string) {
    await this.project(companyId, projectId);
    const lastReadAt = new Date();
    await this.prisma.projectMessageRead.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: { companyId, projectId, userId, lastReadAt },
      update: { lastReadAt },
    });
    return { lastReadAt };
  }

  // Doppelt gesendet (Offline-Warteschlange, zweiter Versuch): die vorhandene Nachricht
  private async existing(companyId: string, clientId?: string) {
    if (!clientId) return null;
    return this.prisma.projectMessage.findFirst({ where: { companyId, clientId }, select: messageSelect });
  }

  async postMessage(companyId: string, userId: string, projectId: string, text: string, clientId?: string) {
    await this.project(companyId, projectId);
    const trimmed = text.trim();
    if (!trimmed) throw new BadRequestException('Die Nachricht ist leer.');
    const known = await this.existing(companyId, clientId);
    if (known) return known;
    return this.create(companyId, { projectId, authorUserId: userId, text: trimmed, clientId });
  }

  // Unique-Konflikt beim gleichzeitigen zweiten Versuch: die erste gewinnt
  private async create(
    companyId: string,
    data: Omit<Prisma.ProjectMessageUncheckedCreateInput, 'companyId'>,
  ) {
    try {
      return await this.prisma.projectMessage.create({ data: { ...data, companyId }, select: messageSelect });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && data.clientId) {
        return (await this.existing(companyId, data.clientId))!;
      }
      throw error;
    }
  }

  // Foto als Dokument (Art "photo") am Projekt und als Nachricht im Verlauf
  async postPhoto(
    companyId: string,
    userId: string,
    projectId: string,
    file: UploadedFile,
    caption?: string,
    clientId?: string,
  ) {
    const project = await this.project(companyId, projectId);
    if (!IMAGE_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Nur Fotos (JPEG, PNG, WebP, HEIC).');
    }
    const known = await this.existing(companyId, clientId);
    if (known) return known;
    const stored = await this.storage.save(companyId, file.originalname || 'foto.jpg', file.buffer);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const document = await tx.document.create({
          data: {
            companyId,
            projectId: project.id,
            fileName: file.originalname || 'foto.jpg',
            documentType: 'photo',
            storagePath: stored.storagePath,
            uploadedByUserId: userId,
          },
        });
        return tx.projectMessage.create({
          data: {
            companyId,
            projectId: project.id,
            authorUserId: userId,
            text: caption?.trim() || null,
            documentId: document.id,
            clientId,
          },
          select: messageSelect,
        });
      });
    } catch (error) {
      await this.storage.remove(companyId, stored.storagePath).catch(() => undefined);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && clientId) {
        return (await this.existing(companyId, clientId))!;
      }
      throw error;
    }
  }

  // Nur Fotos aus Nachrichten – site.use erlaubt keine anderen Dokumente
  async photo(companyId: string, documentId: string) {
    const message = await this.prisma.projectMessage.findFirst({
      where: { companyId, documentId },
      select: { document: { select: { fileName: true, storagePath: true } } },
    });
    if (!message?.document) throw new NotFoundException('Foto nicht gefunden.');
    return {
      fileName: message.document.fileName,
      content: await this.storage.read(companyId, message.document.storagePath),
    };
  }
}
