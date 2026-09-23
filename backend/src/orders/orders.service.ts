import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { writeAudit } from '../common/audit';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateOrderStatusDto } from './dto/order.dto';

// Zielstatus -> erlaubte Ausgangsstatus.
const ALLOWED_ORDER_TRANSITIONS_FROM: Record<OrderStatus, OrderStatus[]> = {
  open: [],
  in_progress: ['open'],
  done: ['in_progress'],
  cancelled: ['open', 'in_progress'],
};

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

    try {
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
    } catch (error) {
      // quoteId ist unique: bei zwei gleichzeitigen Anfragen (Doppelklick)
      // scheitert die zweite erst hier an der Datenbank – als 400 statt 500.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('Für dieses Angebot existiert bereits ein Auftrag.');
      }
      throw error;
    }
  }

  // Feste Übergänge: ein erledigter oder stornierter Auftrag springt nicht
  // mehr zurück. Der Wechsel ist ein bedingtes Update (siehe QuotesService).
  updateStatus(companyId: string, userId: string, id: string, dto: UpdateOrderStatusDto) {
    const from = ALLOWED_ORDER_TRANSITIONS_FROM[dto.status];
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id, companyId } });
      if (!order) {
        throw new NotFoundException('Auftrag nicht gefunden.');
      }
      if (!from.includes(order.status)) {
        throw new BadRequestException(
          `Statuswechsel nicht erlaubt: Auftrag ist "${order.status}", "${dto.status}" geht nur aus [${from.join(', ')}].`,
        );
      }
      const { count } = await tx.order.updateMany({
        where: { id, companyId, status: { in: [order.status] } },
        data: { status: dto.status },
      });
      if (count === 0) {
        throw new BadRequestException('Der Auftrag wurde gerade geändert – bitte neu laden.');
      }
      await writeAudit(tx, {
        companyId,
        userId,
        action: 'order_status',
        entity: 'Order',
        entityId: id,
        oldData: { status: order.status },
        newData: { status: dto.status },
      });
      return { ...order, status: dto.status };
    });
  }
}
