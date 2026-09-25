import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ChecklistTemplate, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { lockFor } from '../common/advisory-lock';
import { writeAudit } from '../common/audit';
import { PERMISSIONS } from '../common/permissions';
import {
  AddItemDto,
  CommentDto,
  CreateChecklistDto,
  ProposeTemplateDto,
  ReviewDto,
  TemplateDto,
  UpdateItemDto,
} from './checklists.dto';

interface Caller {
  companyId: string;
  userId: string;
  permissions: string[];
}

const cleanItems = (items: string[]) => items.map((t) => t.trim()).filter(Boolean);

// Checklisten: Vorlagen und Listen am Projekt anlegen darf der Einsatzplaner
// (checklist.manage); auf der Baustelle (site.use) werden Listen nur
// erweitert, abgehakt und kommentiert. Eine Liste lässt sich als Vorlage
// vorschlagen – der Einsatzplaner prüft und gibt sie frei.
@Injectable()
export class ChecklistsService {
  constructor(private prisma: PrismaService) {}

  canManage(caller: Caller) {
    return caller.permissions.includes(PERMISSIONS.CHECKLIST_MANAGE);
  }

  private requireManage(caller: Caller) {
    if (!this.canManage(caller))
      throw new ForbiddenException('Das darf nur der Einsatzplaner (Recht „Checklisten verwalten“).');
  }

  private async names(companyId: string, ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (!unique.length) return new Map<string, string>();
    const users = await this.prisma.user.findMany({
      where: { companyId, id: { in: unique } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
  }

  // ── Vorlagen ──────────────────────────────────

  private templateView(t: ChecklistTemplate, names: Map<string, string>) {
    return {
      ...t,
      items: t.items as string[],
      proposedBy: t.proposedByUserId ? (names.get(t.proposedByUserId) ?? null) : null,
      reviewedBy: t.reviewedByUserId ? (names.get(t.reviewedByUserId) ?? null) : null,
    };
  }

  // Freigegebene Vorlagen für alle; Vorschläge und Archiv sieht der
  // Einsatzplaner, eigene Vorschläge sieht auch, wer sie gemacht hat
  async listTemplates(caller: Caller) {
    const manage = this.canManage(caller);
    const templates = await this.prisma.checklistTemplate.findMany({
      where: {
        companyId: caller.companyId,
        ...(manage ? {} : { OR: [{ status: 'approved' }, { proposedByUserId: caller.userId }] }),
      },
      orderBy: [{ status: 'asc' }, { title: 'asc' }],
    });
    const names = await this.names(
      caller.companyId,
      templates.flatMap((t) => [t.proposedByUserId, t.reviewedByUserId]),
    );
    return { templates: templates.map((t) => this.templateView(t, names)), canManage: manage };
  }

  async createTemplate(caller: Caller, dto: TemplateDto) {
    this.requireManage(caller);
    const items = cleanItems(dto.items);
    if (!items.length) throw new BadRequestException('Die Vorlage braucht mindestens einen Punkt.');
    return this.prisma.checklistTemplate.create({
      data: {
        companyId: caller.companyId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        items,
        status: 'approved',
        reviewedByUserId: caller.userId,
        reviewedAt: new Date(),
      },
    });
  }

  private async templateOf(companyId: string, id: string) {
    const template = await this.prisma.checklistTemplate.findFirst({ where: { id, companyId } });
    if (!template) throw new NotFoundException('Vorlage nicht gefunden.');
    return template;
  }

  async updateTemplate(caller: Caller, id: string, dto: TemplateDto) {
    this.requireManage(caller);
    await this.templateOf(caller.companyId, id);
    const items = cleanItems(dto.items);
    if (!items.length) throw new BadRequestException('Die Vorlage braucht mindestens einen Punkt.');
    return this.prisma.checklistTemplate.update({
      where: { id },
      data: {
        title: dto.title.trim(),
        description: dto.description === undefined ? undefined : dto.description?.trim() || null,
        items,
        status: dto.status,
      },
    });
  }

  // Prüfung eines Vorschlags: freigeben (optional angepasst) oder ablehnen
  async review(caller: Caller, id: string, dto: ReviewDto) {
    this.requireManage(caller);
    const template = await this.templateOf(caller.companyId, id);
    if (template.status !== 'proposed') throw new BadRequestException('Die Vorlage wurde schon geprüft.');
    const items = dto.items ? cleanItems(dto.items) : undefined;
    if (items && !items.length) throw new BadRequestException('Die Vorlage braucht mindestens einen Punkt.');
    return this.prisma.$transaction(async (tx) => {
      const reviewed = await tx.checklistTemplate.update({
        where: { id },
        data: {
          status: dto.approve ? 'approved' : 'archived',
          title: dto.title?.trim(),
          items,
          reviewNote: dto.note?.trim() || null,
          reviewedByUserId: caller.userId,
          reviewedAt: new Date(),
        },
      });
      await writeAudit(tx, {
        companyId: caller.companyId,
        userId: caller.userId,
        action: dto.approve ? 'checklist_template_approved' : 'checklist_template_rejected',
        entity: 'ChecklistTemplate',
        entityId: id,
        newData: { title: reviewed.title, note: reviewed.reviewNote },
      });
      return reviewed;
    });
  }

  // ── Listen am Projekt ─────────────────────────

  private async projectOf(companyId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, companyId } });
    if (!project) throw new NotFoundException('Projekt nicht gefunden.');
    return project;
  }

  async list(caller: Caller, projectId: string) {
    await this.projectOf(caller.companyId, projectId);
    const checklists = await this.prisma.checklist.findMany({
      where: { companyId: caller.companyId, projectId },
      orderBy: { createdAt: 'asc' },
      include: {
        items: { orderBy: { position: 'asc' } },
        comments: { orderBy: { createdAt: 'asc' } },
        template: { select: { id: true, title: true } },
      },
    });
    const names = await this.names(
      caller.companyId,
      checklists.flatMap((c) => [
        c.createdByUserId,
        ...c.items.flatMap((i) => [i.addedByUserId, i.doneByUserId]),
        ...c.comments.map((m) => m.userId),
      ]),
    );
    const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
    return {
      canManage: this.canManage(caller),
      checklists: checklists.map((c) => ({
        ...c,
        createdBy: name(c.createdByUserId),
        items: c.items.map((i) => ({
          ...i,
          addedBy: name(i.addedByUserId),
          doneBy: name(i.doneByUserId),
          // von jemand anderem als dem Ersteller der Liste ergänzt (Baustelle)
          addedOnSite: i.addedByUserId !== c.createdByUserId,
        })),
        comments: c.comments.map((m) => ({ ...m, user: name(m.userId) })),
        progress: { done: c.items.filter((i) => i.doneAt).length, total: c.items.length },
      })),
    };
  }

  async create(caller: Caller, projectId: string, dto: CreateChecklistDto) {
    this.requireManage(caller);
    await this.projectOf(caller.companyId, projectId);
    let items: string[] = [];
    if (dto.templateId) {
      const template = await this.templateOf(caller.companyId, dto.templateId);
      if (template.status !== 'approved')
        throw new BadRequestException('Nur freigegebene Vorlagen lassen sich verwenden.');
      items = template.items as string[];
    }
    return this.prisma.checklist.create({
      data: {
        companyId: caller.companyId,
        projectId,
        title: dto.title.trim(),
        templateId: dto.templateId ?? null,
        createdByUserId: caller.userId,
        items: {
          create: items.map((text, position) => ({
            companyId: caller.companyId,
            text,
            position,
            addedByUserId: caller.userId,
          })),
        },
      },
      include: { items: true },
    });
  }

  private async checklistOf(companyId: string, id: string) {
    const checklist = await this.prisma.checklist.findFirst({ where: { id, companyId } });
    if (!checklist) throw new NotFoundException('Checkliste nicht gefunden.');
    return checklist;
  }

  async remove(caller: Caller, id: string) {
    this.requireManage(caller);
    await this.checklistOf(caller.companyId, id);
    await this.prisma.checklist.delete({ where: { id } });
    return { deleted: true };
  }

  // Erweitern darf jeder auf der Baustelle – neue Punkte kommen ans Ende
  async addItem(caller: Caller, checklistId: string, dto: AddItemDto) {
    await this.checklistOf(caller.companyId, checklistId);
    return this.prisma.$transaction(async (tx) => {
      await lockFor(tx, 'checklist', checklistId);
      const last = await tx.checklistItem.findFirst({
        where: { companyId: caller.companyId, checklistId },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      return tx.checklistItem.create({
        data: {
          companyId: caller.companyId,
          checklistId,
          text: dto.text.trim(),
          position: (last?.position ?? -1) + 1,
          addedByUserId: caller.userId,
        },
      });
    });
  }

  private async itemOf(companyId: string, id: string) {
    const item = await this.prisma.checklistItem.findFirst({ where: { id, companyId } });
    if (!item) throw new NotFoundException('Punkt nicht gefunden.');
    return item;
  }

  // Abhaken darf jeder; den Text ändern nur der Einsatzplaner
  async updateItem(caller: Caller, id: string, dto: UpdateItemDto) {
    const item = await this.itemOf(caller.companyId, id);
    if (dto.text !== undefined && dto.text.trim() !== item.text) this.requireManage(caller);
    const data: Prisma.ChecklistItemUpdateInput = {};
    if (dto.text !== undefined) data.text = dto.text.trim();
    if (dto.done !== undefined && dto.done !== !!item.doneAt) {
      data.doneAt = dto.done ? new Date() : null;
      data.doneByUserId = dto.done ? caller.userId : null;
    }
    return this.prisma.checklistItem.update({ where: { id }, data });
  }

  async removeItem(caller: Caller, id: string) {
    this.requireManage(caller);
    await this.itemOf(caller.companyId, id);
    await this.prisma.checklistItem.delete({ where: { id } });
    return { deleted: true };
  }

  async comment(caller: Caller, checklistId: string, dto: CommentDto) {
    await this.checklistOf(caller.companyId, checklistId);
    if (dto.itemId) {
      const item = await this.itemOf(caller.companyId, dto.itemId);
      if (item.checklistId !== checklistId)
        throw new BadRequestException('Der Punkt gehört zu einer anderen Liste.');
    }
    return this.prisma.checklistComment.create({
      data: {
        companyId: caller.companyId,
        checklistId,
        itemId: dto.itemId ?? null,
        userId: caller.userId,
        text: dto.text.trim(),
      },
    });
  }

  // Aus einer Liste eine Vorlage machen: der Einsatzplaner legt sie direkt
  // frei an, alle anderen schlagen sie zur Prüfung vor
  async proposeTemplate(caller: Caller, checklistId: string, dto: ProposeTemplateDto) {
    await this.checklistOf(caller.companyId, checklistId);
    const items = await this.prisma.checklistItem.findMany({
      where: { companyId: caller.companyId, checklistId },
      orderBy: { position: 'asc' },
      select: { text: true },
    });
    if (!items.length) throw new BadRequestException('Die Liste hat keine Punkte.');
    const manage = this.canManage(caller);
    return this.prisma.checklistTemplate.create({
      data: {
        companyId: caller.companyId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        items: items.map((i) => i.text),
        status: manage ? 'approved' : 'proposed',
        proposedByUserId: manage ? null : caller.userId,
        reviewedByUserId: manage ? caller.userId : null,
        reviewedAt: manage ? new Date() : null,
      },
    });
  }
}
