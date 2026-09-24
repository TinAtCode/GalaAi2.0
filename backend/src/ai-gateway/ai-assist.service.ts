import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiGatewayService, Caller } from './ai-gateway.service';
import { QuoteTextDto, SiteSummaryDto } from './dto/assist.dto';

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
}
