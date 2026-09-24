import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SitePlan } from '@prisma/client';
import { PDFParse } from 'pdf-parse';
import { PrismaService } from '../prisma/prisma.service';
import { FILE_STORAGE, FileStorage } from '../documents/storage/file-storage.interface';
import { PlanObject } from './plan-catalog';
import { isQuantityKey, planQuantities, validateObjects } from './plan-geometry';
import { convertQuantity, normalizeUnit } from '../common/units';
import { imageSize } from './image-size';
import { CreatePlanDto, UpdatePlanDto } from './plans.dto';

const PDF_RENDER_WIDTH = 2400; // Pixel: genug für Maße, klein genug fürs Tablet
const MAX_BACKGROUND_PIXELS = 40_000_000;

type UploadedFile = { originalname: string; buffer: Buffer; mimetype: string };

// Lagepläne am Projekt
@Injectable()
export class PlansService {
  constructor(
    private prisma: PrismaService,
    @Inject(FILE_STORAGE) private storage: FileStorage,
  ) {}

  private view(plan: SitePlan) {
    const objects = plan.objects as unknown as PlanObject[];
    return {
      id: plan.id,
      projectId: plan.projectId,
      name: plan.name,
      unitsPerMeter: plan.unitsPerMeter,
      background: plan.backgroundDocumentId
        ? {
            documentId: plan.backgroundDocumentId,
            width: plan.backgroundWidth,
            height: plan.backgroundHeight,
          }
        : null,
      objects,
      quantities: planQuantities(objects, plan.unitsPerMeter),
      version: plan.version,
      updatedAt: plan.updatedAt,
    };
  }

  private async project(companyId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, companyId } });
    if (!project) throw new NotFoundException('Projekt nicht gefunden.');
    return project;
  }

  private async plan(companyId: string, id: string) {
    const plan = await this.prisma.sitePlan.findFirst({ where: { id, companyId } });
    if (!plan) throw new NotFoundException('Plan nicht gefunden.');
    return plan;
  }

  async list(companyId: string, projectId: string) {
    await this.project(companyId, projectId);
    const plans = await this.prisma.sitePlan.findMany({
      where: { companyId, projectId },
      orderBy: { createdAt: 'asc' },
    });
    return plans.map((p) => ({
      id: p.id,
      name: p.name,
      objectCount: (p.objects as unknown[]).length,
      hasBackground: !!p.backgroundDocumentId,
      updatedAt: p.updatedAt,
    }));
  }

  async create(companyId: string, projectId: string, dto: CreatePlanDto) {
    await this.project(companyId, projectId);
    const plan = await this.prisma.sitePlan.create({
      data: { companyId, projectId, name: dto.name.trim() },
    });
    return this.view(plan);
  }

  async get(companyId: string, id: string) {
    return this.view(await this.plan(companyId, id));
  }

  async update(companyId: string, id: string, dto: UpdatePlanDto) {
    if (dto.objects !== undefined) {
      const error = validateObjects(dto.objects);
      if (error) throw new BadRequestException(error);
    }
    // nur, wenn seit dem Laden niemand gespeichert hat
    const { count } = await this.prisma.sitePlan.updateMany({
      where: { id, companyId, version: dto.version },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.unitsPerMeter !== undefined ? { unitsPerMeter: dto.unitsPerMeter } : {}),
        ...(dto.objects !== undefined ? { objects: dto.objects as Prisma.InputJsonValue } : {}),
        version: { increment: 1 },
      },
    });
    if (count === 0) {
      await this.plan(companyId, id);
      throw new ConflictException(
        'Der Plan wurde inzwischen von jemand anderem gespeichert. Bitte neu laden.',
      );
    }
    return this.get(companyId, id);
  }

  // Der Hintergrund bleibt als Dokument am Projekt
  async remove(companyId: string, id: string) {
    await this.plan(companyId, id);
    await this.prisma.sitePlan.deleteMany({ where: { id, companyId } });
    return { deleted: true };
  }

  // Hintergrund: Foto, Luftbild oder Plan (PNG/JPEG, PDF: erste Seite)
  async setBackground(companyId: string, userId: string, id: string, file: UploadedFile) {
    const plan = await this.plan(companyId, id);
    const isPdf = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    let image: Buffer;
    let fileName = file.originalname;
    if (isPdf) {
      image = await this.renderFirstPage(file.buffer);
      fileName = `${file.originalname.replace(/\.pdf$/i, '')}.png`;
    } else {
      image = file.buffer;
    }
    const size = imageSize(image);
    if (!size) throw new BadRequestException('Bitte ein Bild (PNG, JPG) oder eine PDF hochladen.');
    if (size.width < 1 || size.height < 1 || size.width * size.height > MAX_BACKGROUND_PIXELS)
      throw new BadRequestException('Das Bild ist zu groß (höchstens 40 Megapixel).');
    const stored = await this.storage.save(companyId, fileName, image);
    const document = await this.prisma.document.create({
      data: {
        companyId,
        projectId: plan.projectId,
        fileName,
        storagePath: stored.storagePath,
        documentType: 'floor_plan',
        uploadedByUserId: userId,
      },
    });
    await this.prisma.sitePlan.updateMany({
      where: { id, companyId },
      data: {
        backgroundDocumentId: document.id,
        backgroundWidth: size.width,
        backgroundHeight: size.height,
        version: { increment: 1 },
      },
    });
    return this.get(companyId, id);
  }

  private async renderFirstPage(pdf: Buffer) {
    const parser = new PDFParse({ data: new Uint8Array(pdf) });
    try {
      const shot = await parser.getScreenshot({
        partial: [1],
        desiredWidth: PDF_RENDER_WIDTH,
        imageBuffer: true,
        imageDataUrl: false,
      });
      const page = shot.pages[0];
      if (!page) throw new Error('keine Seite');
      return Buffer.from(page.data);
    } catch {
      throw new BadRequestException('Die PDF ließ sich nicht lesen.');
    } finally {
      await parser.destroy();
    }
  }

  async removeBackground(companyId: string, id: string) {
    await this.plan(companyId, id);
    await this.prisma.sitePlan.updateMany({
      where: { id, companyId },
      data: {
        backgroundDocumentId: null,
        backgroundWidth: null,
        backgroundHeight: null,
        version: { increment: 1 },
      },
    });
    return this.get(companyId, id);
  }

  async background(companyId: string, id: string) {
    const plan = await this.plan(companyId, id);
    if (!plan.backgroundDocumentId) throw new NotFoundException('Der Plan hat keinen Hintergrund.');
    const document = await this.prisma.document.findFirst({
      where: { id: plan.backgroundDocumentId, companyId },
    });
    if (!document) throw new NotFoundException('Hintergrund nicht gefunden.');
    const content = await this.storage.read(companyId, document.storagePath);
    const type = imageSize(content)?.type;
    return { content, contentType: type === 'jpeg' ? 'image/jpeg' : 'image/png' };
  }

  // Angebotsentwurf aus den Mengen des Plans: je Zeile die passenden
  // Leistungen (gleiche Dimension, Menge in deren Einheit umgerechnet) und
  // die gemerkte Zuordnung. Das Angebot selbst legt POST /quotes an – dort
  // gelten Kalkulation und Rundung der Leistung wie immer.
  async quoteDraft(companyId: string, id: string) {
    const plan = await this.plan(companyId, id);
    const rows = planQuantities(plan.objects as unknown as PlanObject[], plan.unitsPerMeter);
    const [services, mappings] = await Promise.all([
      this.prisma.service.findMany({
        where: { companyId },
        select: { id: true, name: true, unit: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.planServiceMapping.findMany({ where: { companyId } }),
    ]);
    return {
      planId: plan.id,
      projectId: plan.projectId,
      rows: rows.map((row) => {
        const candidates = services
          .map((service) => ({ ...service, quantity: convert(row.quantity, row.unit, service.unit) }))
          .filter((c): c is typeof c & { quantity: number } => c.quantity !== null);
        const mapped = mappings.find((m) => m.quantityKey === row.key)?.serviceId;
        return {
          ...row,
          serviceId: candidates.some((c) => c.id === mapped) ? mapped! : null,
          candidates,
        };
      }),
    };
  }

  async setMapping(companyId: string, key: string, serviceId: string | null) {
    if (!isQuantityKey(key)) throw new BadRequestException('Unbekannte Mengenzeile.');
    if (!serviceId) {
      await this.prisma.planServiceMapping.deleteMany({ where: { companyId, quantityKey: key } });
      return { quantityKey: key, serviceId: null };
    }
    const service = await this.prisma.service.findFirst({ where: { id: serviceId, companyId } });
    if (!service) throw new NotFoundException('Leistung nicht gefunden.');
    await this.prisma.planServiceMapping.upsert({
      where: { companyId_quantityKey: { companyId, quantityKey: key } },
      create: { companyId, quantityKey: key, serviceId },
      update: { serviceId },
    });
    return { quantityKey: key, serviceId };
  }
}

// Menge in die Einheit der Leistung (3 Nachkommastellen); null = passt nicht
function convert(quantity: number, from: string, to: string): number | null {
  if (normalizeUnit(from) === normalizeUnit(to)) return quantity;
  const converted = convertQuantity(quantity, from, to);
  return converted ? Math.round(converted.toNumber() * 1000) / 1000 : null;
}
