import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PlanObject } from '../plans/plan-catalog';
import { validateObjects } from '../plans/plan-geometry';
import { objectsFromAi, PLAN_AI_PROMPT, planForAi } from '../plans/plan-ai';
import { jsonFromText } from '../finance/payables/ai-read';
import { FILE_STORAGE, FileStorage } from '../documents/storage/file-storage.interface';
import { imageMediaType, imagesForAi } from './images';
import { PrismaService } from '../prisma/prisma.service';
import { AiGatewayService, Caller } from './ai-gateway.service';
import { PhotoDescriptionDto, PlanDrawingDto, QuoteTextDto, SiteSummaryDto } from './dto/assist.dto';

// so viele Nachrichten gehen höchstens in eine Zusammenfassung
const SUMMARY_MESSAGES = 100;

// Die Funktionen der App, die eine KI-Aufgabe nutzen. Den Kontext stellt
// der Server zusammen – nur, was für die Aufgabe nötig ist, ohne
// Einkaufspreise, Kalkulation oder Löhne.
@Injectable()
export class AiAssistService {
  constructor(
    private prisma: PrismaService,
    private ai: AiGatewayService,
    @Inject(FILE_STORAGE) private storage: FileStorage,
  ) {}

  private async project(companyId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
      select: {
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
    });
    if (!project) throw new NotFoundException('Projekt nicht gefunden.');
    return project;
  }

  async quoteText(caller: Caller, dto: QuoteTextDto) {
    const project = await this.project(caller.companyId, dto.projectId);
    const serviceIds = dto.lines.map((l) => l.serviceId).filter((id): id is string => !!id);
    const services = serviceIds.length
      ? await this.prisma.service.findMany({
          where: { companyId: caller.companyId, id: { in: serviceIds } },
          select: { id: true, name: true, unit: true },
        })
      : [];
    const lines = dto.lines
      .map((line) => {
        const service = services.find((s) => s.id === line.serviceId);
        return {
          leistung: service?.name ?? line.description?.trim() ?? '',
          menge: line.quantity ?? null,
          einheit: line.unit ?? service?.unit ?? null,
        };
      })
      .filter((line) => line.leistung);
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: caller.companyId },
      select: { name: true },
    });
    const prompt = [
      `Schreibe das Anschreiben für ein Angebot eines Garten- und Landschaftsbaubetriebs (${company.name}).`,
      'Ein bis drei kurze Absätze auf Deutsch, Anrede an den Kunden, was angeboten wird, freundlicher Schluss.',
      'Keine Preise, keine Summen, keine Positionsliste (die folgt darunter), keine Grußformel mit Namen.',
      dto.hint?.trim() ? `Wunsch: ${dto.hint.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const result = await this.ai.runTask(caller, 'angebotstext', prompt, {
      kunde: project.property.customer.name,
      objekt: {
        bezeichnung: project.property.label,
        ort: [
          project.property.street,
          [project.property.postalCode, project.property.city].filter(Boolean).join(' '),
        ]
          .filter(Boolean)
          .join(', '),
      },
      projekt: project.title,
      positionen: lines,
    });
    return { text: result.text.trim(), providerName: result.providerName, model: result.model ?? null };
  }

  async siteSummary(caller: Caller, dto: SiteSummaryDto) {
    const project = await this.project(caller.companyId, dto.projectId);
    const messages = await this.prisma.projectMessage.findMany({
      where: { companyId: caller.companyId, projectId: dto.projectId },
      orderBy: { createdAt: 'desc' },
      take: SUMMARY_MESSAGES,
      select: {
        text: true,
        documentId: true,
        createdAt: true,
        author: { select: { firstName: true, lastName: true } },
      },
    });
    const verlauf = messages.reverse().map((m) => ({
      zeit: m.createdAt.toISOString(),
      von: `${m.author.firstName} ${m.author.lastName}`.trim(),
      text: m.text ?? (m.documentId ? '[Foto]' : ''),
    }));
    if (!verlauf.length) {
      return { text: 'Zu diesem Projekt gibt es noch keine Nachrichten.', providerName: null, model: null };
    }
    const prompt = [
      'Fasse den Verlauf dieser Baustelle für das Büro zusammen (Deutsch, Stichpunkte).',
      'Was ist erledigt, was ist offen, welche Probleme oder Wünsche des Kunden gab es, was muss das Büro tun?',
      'Nur was im Verlauf steht, nichts erfinden.',
    ].join('\n');
    const result = await this.ai.runTask(caller, 'baustelle_zusammenfassung', prompt, {
      projekt: project.title,
      kunde: project.property.customer.name,
      nachrichten: verlauf,
    });
    return { text: result.text.trim(), providerName: result.providerName, model: result.model ?? null };
  }

  // Baustellenfoto beschreiben (Aufgabe „foto_beschreiben“, Anbieter mit
  // „Bilder verstehen“). Nur Fotos aus den Baustellen-Nachrichten.
  async photoDescription(caller: Caller, dto: PhotoDescriptionDto) {
    const message = await this.prisma.projectMessage.findFirst({
      where: { companyId: caller.companyId, documentId: dto.documentId },
      select: {
        text: true,
        project: { select: { title: true } },
        document: { select: { storagePath: true } },
      },
    });
    if (!message?.document) throw new NotFoundException('Foto nicht gefunden.');
    const images = await imagesForAi(await this.storage.read(caller.companyId, message.document.storagePath));
    const prompt = [
      'Beschreibe dieses Foto von einer Baustelle im Garten- und Landschaftsbau für das Büro (Deutsch, 2–5 Sätze).',
      'Was ist zu sehen: Stand der Arbeiten, verbautes oder fehlendes Material, Schäden oder Auffälligkeiten.',
      'Nur was auf dem Foto zu erkennen ist, nichts erfinden.',
    ].join('\n');
    const result = await this.ai.runTask(
      caller,
      'foto_beschreiben',
      prompt,
      { projekt: message.project.title, ...(message.text ? { nachricht: message.text } : {}) },
      images,
    );
    return { text: result.text.trim(), providerName: result.providerName, model: result.model ?? null };
  }

  // Lageplan zeichnen (Aufgabe „lageplan_zeichnen“, Anbieter mit „Bilder/
  // Zeichnungen erzeugen“): Die KI liefert Objekte in Metern, GartenAI prüft
  // und rechnet sie um. Gespeichert wird nichts – der Vorschlag landet im
  // Editor und lässt sich rückgängig machen. Ein eigener Agent darf zusätzlich
  // ein Bild liefern (data.image), das man als Hintergrund übernehmen kann.
  async planDrawing(caller: Caller, planId: string, dto: PlanDrawingDto) {
    const plan = await this.prisma.sitePlan.findFirst({
      where: { id: planId, companyId: caller.companyId },
      select: {
        name: true,
        unitsPerMeter: true,
        objects: true,
        backgroundWidth: true,
        backgroundHeight: true,
      },
    });
    if (!plan) throw new NotFoundException('Lageplan nicht gefunden.');
    if (dto.objects !== undefined) {
      const error = validateObjects(dto.objects);
      if (error) throw new BadRequestException(error);
    }
    const unitsPerMeter = dto.unitsPerMeter ?? plan.unitsPerMeter;
    const current = (dto.objects ?? plan.objects) as unknown as PlanObject[];
    const extent: [number, number] =
      plan.backgroundWidth && plan.backgroundHeight
        ? [plan.backgroundWidth, plan.backgroundHeight]
        : [2000, 1500];
    const result = await this.ai.runTask(
      caller,
      'lageplan_zeichnen',
      `${PLAN_AI_PROMPT}\n\nAuftrag: ${dto.instruction.trim()}`,
      { plan: plan.name, ...planForAi(current, unitsPerMeter, extent) },
    );
    const data = result.data as
      { objects?: unknown; image?: { mediaType?: unknown; data?: unknown } } | undefined;
    const raw = Array.isArray(data?.objects) ? data.objects : jsonFromText(result.text)?.objects;
    const { objects, dropped } = objectsFromAi(raw, unitsPerMeter);

    let image: { mediaType: string; data: string } | null = null;
    if (typeof data?.image?.data === 'string') {
      const buffer = Buffer.from(data.image.data, 'base64');
      const mediaType = imageMediaType(buffer);
      if ((mediaType === 'image/png' || mediaType === 'image/jpeg') && buffer.length <= 10 * 1024 * 1024) {
        image = { mediaType, data: data.image.data };
      }
    }
    const note = jsonFromText(result.text) ? null : result.text.trim().slice(0, 500) || null;
    return { objects, dropped, image, note, providerName: result.providerName };
  }
}
