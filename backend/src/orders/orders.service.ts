import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateOrderStatusDto } from './dto/order.dto';

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  private async assertOrderBelongsToCompany(companyId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, companyId },
    });
    if (!order) {
      throw new NotFoundException('Auftrag nicht gefunden.');
    }
    return order;
  }

  findAllForProject(companyId: string, projectId: string) {
    return this.prisma.order.findMany({
      where: { projectId, companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(companyId: string, id: string) {
    return this.assertOrderBelongsToCompany(companyId, id);
  }

  // Punkt 22: "Angebot angenommen -> Auftrag erzeugen -> Projekt aktualisieren".
  // Diese Methode setzt genau diese Regeln durch:
  //  1. Das Angebot muss zur Firma gehören (Mandantenprüfung über companyId).
  //  2. Das Angebot muss den Status "accepted" haben.
  //  3. Aus einem Angebot darf höchstens EIN Auftrag entstehen
  //     (verhindert versehentliches Doppel-Anlegen bei Doppelklick etc.).
  async createFromQuote(companyId: string, quoteId: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, companyId },
      include: { order: true },
    });
    if (!quote) {
      throw new NotFoundException('Angebot nicht gefunden.');
    }
    if (quote.status !== 'accepted') {
      throw new BadRequestException(
        `Aus einem Angebot mit Status "${quote.status}" kann kein Auftrag erzeugt werden (erforderlich: "accepted").`,
      );
    }
    if (quote.order) {
      throw new BadRequestException('Für dieses Angebot existiert bereits ein Auftrag.');
    }

    const [order] = await this.prisma.$transaction([
      this.prisma.order.create({
        data: { companyId, projectId: quote.projectId, quoteId: quote.id, totalNet: quote.totalNet },
      }),
      // Projekt rückt in Bearbeitung, sobald ein Auftrag existiert – nur
      // wenn es noch im Ausgangszustand "open" ist (kein Überschreiben,
      // falls das Projekt manuell schon weiter gesetzt wurde).
      this.prisma.project.updateMany({
        where: { id: quote.projectId, companyId, status: 'open' },
        data: { status: 'in_progress' },
      }),
    ]);

    return order;
  }

  async updateStatus(companyId: string, id: string, dto: UpdateOrderStatusDto) {
    await this.assertOrderBelongsToCompany(companyId, id);
    return this.prisma.order.update({ where: { id }, data: { status: dto.status } });
  }
}
