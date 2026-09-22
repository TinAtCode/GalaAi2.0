import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrdersService } from '../src/orders/orders.service';

function createPrismaMock() {
  const quotes: any[] = [
    { id: 'quote-open', projectId: 'proj-a', status: 'sent', totalNet: 200, order: null },
    { id: 'quote-accepted', projectId: 'proj-a', status: 'accepted', totalNet: 200, order: null },
  ];
  const projects: any[] = [{ id: 'proj-a', status: 'open' }];
  const orders: any[] = [];

  return {
    quote: {
      findFirst: jest.fn(({ where }: any) => {
        const quote = quotes.find((q) => q.id === where.id);
        if (!quote) return Promise.resolve(null);
        const requiredCompanyId = where.companyId;
        if (requiredCompanyId && requiredCompanyId !== 'company-a') return Promise.resolve(null);
        return Promise.resolve(quote);
      }),
    },
    order: {
      findFirst: jest.fn(({ where }: any) => {
        const order = orders.find((o) => o.id === where.id);
        if (!order) return Promise.resolve(null);
        const requiredCompanyId = where.companyId;
        if (requiredCompanyId && requiredCompanyId !== 'company-a') return Promise.resolve(null);
        return Promise.resolve(order);
      }),
      create: jest.fn(({ data }: any) => {
        const order = { id: `order-${orders.length + 1}`, status: 'open', ...data };
        orders.push(order);
        const quote = quotes.find((q) => q.id === data.quoteId);
        if (quote) quote.order = order;
        return order;
      }),
      update: jest.fn(({ where, data }: any) => {
        const order = orders.find((o) => o.id === where.id);
        Object.assign(order, data);
        return Promise.resolve(order);
      }),
    },
    project: {
      updateMany: jest.fn(({ where, data }: any) => {
        const project = projects.find((p) => p.id === where.id && p.status === where.status);
        if (project) Object.assign(project, data);
        return Promise.resolve({ count: project ? 1 : 0 });
      }),
    },
    $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
  };
}

describe('OrdersService – Auftrag aus Angebot', () => {
  it('lehnt Auftragserstellung ab, wenn das Angebot nicht "accepted" ist', async () => {
    const prisma = createPrismaMock();
    const service = new OrdersService(prisma as any);

    await expect(service.createFromQuote('company-a', 'quote-open')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('erzeugt einen Auftrag aus einem angenommenen Angebot und setzt das Projekt auf in_progress', async () => {
    const prisma = createPrismaMock();
    const service = new OrdersService(prisma as any);

    const order = await service.createFromQuote('company-a', 'quote-accepted');
    expect(order.projectId).toBe('proj-a');
    expect(order.totalNet).toBe(200);

    const project = await (prisma as any).project.updateMany({
      where: { id: 'proj-a', status: 'open' },
      data: {},
    });
    // Projekt wurde bereits beim ersten Aufruf auf "in_progress" gesetzt,
    // daher greift dieser zweite (nur zu Prüfzwecken simulierte) Aufruf nicht mehr.
    expect(project.count).toBe(0);
  });

  it('verhindert einen zweiten Auftrag aus demselben Angebot', async () => {
    const prisma = createPrismaMock();
    const service = new OrdersService(prisma as any);

    await service.createFromQuote('company-a', 'quote-accepted');
    await expect(service.createFromQuote('company-a', 'quote-accepted')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('Angebot einer fremden Firma ist nicht erreichbar', async () => {
    const prisma = createPrismaMock();
    const service = new OrdersService(prisma as any);

    await expect(service.createFromQuote('company-b', 'quote-accepted')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
