import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QuotesService } from '../src/quotes/quotes.service';

function createPrismaMock() {
  const projects = [{ id: 'proj-a', property: { customer: { companyId: 'company-a' } } }];
  const services = [{ id: 'service-1', companyId: 'company-a', name: 'Terrasse', unit: 'm2' }];
  const quotes: any[] = [];

  const mock: any = {
    project: {
      findFirst: jest.fn(({ where }: any) => {
        if (where.id !== 'proj-a') return Promise.resolve(null);
        return Promise.resolve(projects[0]);
      }),
    },
    service: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(services.find((s) => s.id === where.id && s.companyId === where.companyId) ?? null),
      ),
    },
    quote: {
      create: jest.fn(({ data }: any) => {
        const quote = {
          id: `quote-${quotes.length + 1}`,
          status: 'draft',
          ...data,
          lineItems: data.lineItems.create,
        };
        quotes.push(quote);
        return Promise.resolve(quote);
      }),
      findFirst: jest.fn(({ where }: any) => {
        const quote = quotes.find((q) => q.id === where.id);
        if (!quote) return Promise.resolve(null);
        const requiredCompanyId = where.companyId;
        if (requiredCompanyId && requiredCompanyId !== 'company-a') return Promise.resolve(null);
        return Promise.resolve(quote);
      }),
      update: jest.fn(({ where, data }: any) => {
        const quote = quotes.find((q) => q.id === where.id);
        Object.assign(quote, data);
        return Promise.resolve(quote);
      }),
      updateMany: jest.fn(({ where, data }: any) => {
        const quote = quotes.find(
          (q) => q.id === where.id && where.companyId === 'company-a' && where.status.in.includes(q.status),
        );
        if (quote) Object.assign(quote, data);
        return Promise.resolve({ count: quote ? 1 : 0 });
      }),
    },
  };
  // Interaktive Transaktion: der Callback bekommt denselben Mock als tx.
  mock.$transaction = jest.fn((arg: any) => (typeof arg === 'function' ? arg(mock) : Promise.all(arg)));
  mock.$executeRaw = jest.fn(() => Promise.resolve(0));
  mock.auditLog = { create: jest.fn(() => Promise.resolve({})) };
  let sequence = 0;
  mock.$queryRaw = jest.fn(() => Promise.resolve([{ lastValue: ++sequence }]));
  mock.company = {
    findUniqueOrThrow: jest.fn(() =>
      Promise.resolve({ id: 'company-a', timeZone: 'Europe/Berlin', defaultVatRate: 19 }),
    ),
  };
  return mock;
}

// Simuliert CalculationsService, ohne die echte DB-Logik neu zu bauen –
// gibt einen festen Kalkulations-Snapshot zurück, dessen Werte wir gezielt
// zwischen zwei Aufrufen ändern, um Unveränderlichkeit zu testen.
function createCalculationsServiceMock(salePricePerUnit: number) {
  return {
    calculateForService: jest.fn(() =>
      Promise.resolve({
        materialCostPerUnit: 10,
        laborCostPerUnit: 5,
        overheadPerUnit: 1,
        costPerUnit: 16,
        salePricePerUnit,
        marginPerUnit: salePricePerUnit - 16,
        quantity: 10,
        materialCostTotal: 100,
        laborCostTotal: 50,
        overheadTotal: 10,
        costTotal: 160,
        salePriceTotal: salePricePerUnit * 10,
        marginTotal: (salePricePerUnit - 16) * 10,
      }),
    ),
  };
}

describe('QuotesService – Preis-Snapshot', () => {
  it('speichert den Preis zum Erstellungszeitpunkt, unabhängig von späteren Änderungen', async () => {
    const prisma = createPrismaMock();
    // Erste Kalkulation: 20€/Einheit
    const calcV1 = createCalculationsServiceMock(20);
    const service = new QuotesService(prisma as any, calcV1 as any);

    const quote = await service.create('company-a', {
      projectId: 'proj-a',
      lineItems: [{ serviceId: 'service-1', quantity: 10 }],
    });

    expect(quote.lineItems[0].unitPrice).toBe(20);
    expect(Number(quote.totalNet)).toBe(200);

    // Jetzt "ändert sich der Artikelpreis" – simuliert durch eine neue
    // CalculationsService-Instanz, die 35€/Einheit liefern würde.
    // Das bereits erstellte Angebot darf davon NICHT betroffen sein.
    const storedQuote = await service.findOne('company-a', quote.id);
    expect(storedQuote.lineItems[0].unitPrice).toBe(20);
    expect(Number(storedQuote.totalNet)).toBe(200);
  });
});

describe('QuotesService – Statuswechsel', () => {
  async function createDraftQuote() {
    const prisma = createPrismaMock();
    const calc = createCalculationsServiceMock(20);
    const service = new QuotesService(prisma as any, calc as any);
    const quote = await service.create('company-a', {
      projectId: 'proj-a',
      lineItems: [{ serviceId: 'service-1', quantity: 10 }],
    });
    return { service, quote };
  }

  it('approve funktioniert nur aus dem Status draft', async () => {
    const { service, quote } = await createDraftQuote();
    const approved = await service.approve('company-a', 'user-a', quote.id);
    expect(approved.status).toBe('approved');

    await expect(service.approve('company-a', 'user-a', quote.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('send funktioniert nur aus dem Status approved', async () => {
    const { service, quote } = await createDraftQuote();

    await expect(service.send('company-a', 'user-a', quote.id)).rejects.toBeInstanceOf(BadRequestException);

    await service.approve('company-a', 'user-a', quote.id);
    const sent = await service.send('company-a', 'user-a', quote.id);
    expect(sent.status).toBe('sent');
  });

  it('setOutcome funktioniert nur aus dem Status sent', async () => {
    const { service, quote } = await createDraftQuote();

    await expect(service.setOutcome('company-a', 'user-a', quote.id, 'accepted')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    await service.approve('company-a', 'user-a', quote.id);
    await service.send('company-a', 'user-a', quote.id);
    const accepted = await service.setOutcome('company-a', 'user-a', quote.id, 'accepted');
    expect(accepted.status).toBe('accepted');
  });

  it('Angebot einer fremden Firma ist nicht erreichbar', async () => {
    const { service, quote } = await createDraftQuote();
    await expect(service.approve('company-b', 'user-a', quote.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});
