import { NotFoundException } from '@nestjs/common';
import { calculateMargin, PostCalculationService } from '../src/post-calculation/post-calculation.service';

function createPrismaMock() {
  const projects = [{ id: 'proj-a', property: { customer: { companyId: 'company-a' } } }];
  const order = {
    projectId: 'proj-a',
    quote: {
      totalNet: '1500.00',
      lineItems: [{ id: 'li-1', serviceId: 'service-1', quantity: 10 }],
    },
  };
  const articles = { 'art-1': { id: 'art-1', purchasePrice: 5 } };
  const services = [
    {
      id: 'service-1',
      components: [
        { laborMinutes: 20, quantityPer: 0, articleId: null, article: null },
        { laborMinutes: null, quantityPer: 2, articleId: 'art-1', article: articles['art-1'] }, // 2 * 5€ = 10€/Einheit
      ],
    },
  ];
  const timeEntries = [
    {
      projectId: 'proj-a',
      status: 'completed',
      startTime: new Date('2026-01-01T08:00:00Z'),
      endTime: new Date('2026-01-01T11:00:00Z'),
      breakMinutes: 0,
    }, // 180 Min
    {
      projectId: 'proj-a',
      status: 'approved',
      startTime: new Date('2026-01-02T08:00:00Z'),
      endTime: new Date('2026-01-02T12:00:00Z'),
      breakMinutes: 30,
    }, // 210 Min
    {
      projectId: 'proj-a',
      status: 'open',
      startTime: new Date('2026-01-03T08:00:00Z'),
      endTime: null,
      breakMinutes: 0,
    }, // zählt nicht
  ];
  const materialUsages = [
    { projectId: 'proj-a', quantity: 15, article: { purchasePrice: 5 } }, // 75€
    { projectId: 'proj-a', quantity: 5, article: { purchasePrice: 5 } }, // 25€
  ];

  return {
    project: {
      findFirst: jest.fn(({ where }: any) => {
        if (where.id !== 'proj-a') return Promise.resolve(null);
        const requiredCompanyId = where.companyId;
        if (requiredCompanyId && requiredCompanyId !== 'company-a') return Promise.resolve(null);
        return Promise.resolve(projects[0]);
      }),
    },
    order: {
      findMany: jest.fn(({ where }: any) =>
        where.projectId === 'proj-a' ? Promise.resolve([order]) : Promise.resolve([]),
      ),
    },
    service: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(services.find((s) => s.id === where.id) ?? null),
      ),
    },
    timeEntry: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          timeEntries.filter((t) => t.projectId === where.projectId && where.status.in.includes(t.status)),
        ),
      ),
    },
    projectMaterialUsage: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(materialUsages.filter((m) => m.projectId === where.projectId)),
      ),
    },
    invoice: {
      findMany: jest.fn(() => Promise.resolve([{ totalNet: '600.00' }, { totalNet: '400.00' }])),
    },
    company: {
      findUniqueOrThrow: jest.fn(() => Promise.resolve({ hourlyLaborRate: '45.00' })),
    },
    incomingInvoice: {
      findMany: jest.fn(() =>
        Promise.resolve([
          { amount: '119.00', netAmount: '100.00' },
          { amount: '20.00', netAmount: null },
        ]),
      ),
    },
  };
}

describe('PostCalculationService', () => {
  it('kombiniert Soll aus der Rezeptur und Ist aus Zeiteinträgen UND Materialverbrauch', async () => {
    const prisma = createPrismaMock();
    const service = new PostCalculationService(prisma as any);

    const result = await service.calculateForProject('company-a', 'proj-a');

    // Arbeitszeit: Soll 10*20=200 Min, Ist 180+210=390 Min
    expect(result.labor.planned).toBe(200);
    expect(result.labor.actual).toBe(390);
    expect(result.labor.deviationAbs).toBe(190);

    // Material: Soll 10 Einheiten * 10€/Einheit (2*5€) = 100€, Ist 75+25=100€
    expect(result.material.planned).toBe(100);
    expect(result.material.actual).toBe(100);
    expect(result.material.deviationAbs).toBe(0);
    expect(result.material.deviationPercent).toBe(0);
    expect(result.purchases).toEqual({ count: 2, net: 120 });
    // Deckungsbeitrag: 1000 Umsatz − (6,5 h × 45 € + 100 € Material + 120 € Einkauf)
    expect(result.margin).toEqual({
      orderValue: 1500,
      invoiced: 1000,
      costs: { labor: 292.5, material: 100, purchases: 120, total: 512.5 },
      hourlyRate: 45,
      contribution: 487.5,
      contributionPercent: 48.75,
    });
  });

  it('ohne Umsatz kein Prozentwert', () => {
    expect(
      calculateMargin({
        orderValue: 0,
        invoiced: 0,
        laborMinutes: 60,
        hourlyRate: 50,
        material: 0,
        purchases: 0,
      }),
    ).toMatchObject({ contribution: -50, contributionPercent: null });
  });

  it('Projekt einer fremden Firma ist nicht erreichbar', async () => {
    const prisma = createPrismaMock();
    const service = new PostCalculationService(prisma as any);

    await expect(service.calculateForProject('company-b', 'proj-a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
