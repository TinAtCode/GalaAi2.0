import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { writeAudit } from '../common/audit';
import { QuotesService } from './quotes.service';
import { buildX84, GaebInfo, parseGaeb } from './gaeb';

const normalized = (text: string) => text.toLocaleLowerCase('de-DE').replace(/\s+/g, ' ').trim();

// GAEB-Leistungsverzeichnis → Angebotsentwurf, Angebot → X84
@Injectable()
export class GaebService {
  constructor(
    private prisma: PrismaService,
    private quotes: QuotesService,
  ) {}

  // Jede LV-Position wird eine Angebotsposition mit Ordnungszahl, Menge
  // genau wie im LV (keine Rundung). Heißt eine Leistung im Katalog genauso
  // wie der Kurztext, kommt der Preis aus der Kalkulation; sonst freie
  // Position mit Preis 0 – die Preise trägt man danach im Entwurf ein.
  async importLv(companyId: string, userId: string, projectId: string, file: Buffer, fileName: string) {
    const { info, items, skipped } = parseGaeb(file);
    if (items.length === 0) {
      throw new BadRequestException(
        `Keine übernehmbaren Positionen (${skipped.length} übersprungen: nur Bedarfs-, Wahl- oder Positionen ohne Menge).`,
      );
    }
    const services = await this.prisma.service.findMany({
      where: { companyId },
      select: { id: true, name: true },
    });
    const byName = new Map(services.map((s) => [normalized(s.name), s.id]));
    const exact = { roundingDecimals: 3, roundingMode: 'half_up' as const };
    let matched = 0;
    const lineItems = items.map((item) => {
      const serviceId = byName.get(normalized(item.shortText));
      if (serviceId) {
        matched++;
        return { serviceId, gaebOz: item.oz, quantity: item.quantity, ...exact };
      }
      return {
        gaebOz: item.oz,
        description: item.shortText.length >= 2 ? item.shortText : `Position ${item.oz}`,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: 0,
        ...exact,
      };
    });
    const title = info.boqLabel ?? info.boqName ?? info.projectLabel ?? fileName;
    const quote = await this.quotes.create(companyId, {
      projectId,
      lineItems,
      introText: `Angebot zum Leistungsverzeichnis „${title}“`.slice(0, 4000),
    });
    await this.prisma.quote.update({
      where: { id: quote.id },
      data: { gaebInfo: info as unknown as Prisma.InputJsonValue },
    });
    await writeAudit(this.prisma, {
      companyId,
      userId,
      action: 'gaeb_import',
      entity: 'Quote',
      entityId: quote.id,
      newData: { fileName, items: items.length, matched, skipped: skipped.length } as Prisma.InputJsonValue,
    });
    return {
      quoteId: quote.id,
      number: quote.number,
      imported: items.length,
      matched,
      skipped,
    };
  }

  async exportX84(companyId: string, quoteId: string) {
    const quote = await this.quotes.findOne(companyId, quoteId);
    const [company, project] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
      this.prisma.project.findUniqueOrThrow({ where: { id: quote.projectId } }),
    ]);
    if (quote.lineItems.some((l) => l.unitPrice.isZero())) {
      // eine Abgabe mit 0,00 € ist fast immer ein Versehen
      throw new BadRequestException(
        'Mindestens eine Position hat noch keinen Preis (0,00 €). Bitte zuerst alle Preise eintragen.',
      );
    }
    const buffer = buildX84({
      info: (quote.gaebInfo as unknown as GaebInfo | null) ?? null,
      quoteNumber: quote.number ?? quote.id.slice(0, 8),
      projectTitle: project.title,
      bidder: {
        name: company.name,
        street: company.street,
        postalCode: company.postalCode,
        city: company.city,
      },
      lines: quote.lineItems.map((l) => ({
        gaebOz: l.gaebOz,
        description: l.description,
        unit: l.unit,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
      })),
      createdAt: new Date(),
    });
    return { buffer, fileName: `Angebot_${(quote.number ?? 'Entwurf').replace(/[^A-Za-z0-9-]/g, '')}.X84` };
  }
}
