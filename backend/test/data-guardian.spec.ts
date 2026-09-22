import { DataGuardianService } from '../src/data-guardian/data-guardian.service';

function createPrismaMock() {
  const articles = [
    {
      id: 'art-1',
      companyId: 'company-a',
      articleNumber: 'A-1',
      name: 'Schotter',
      unit: 'Sack',
      purchasePrice: 5,
      salePrice: 8,
    },
  ];
  const auditLogs: any[] = [];

  return {
    article: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(articles.filter((a) => a.companyId === where.companyId)),
      ),
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(
          articles.find((a) => a.companyId === where.companyId && a.articleNumber === where.articleNumber) ??
            null,
        ),
      ),
      create: jest.fn(({ data }: any) => {
        const article = { id: `art-${articles.length + 1}`, ...data };
        articles.push(article);
        return Promise.resolve(article);
      }),
      update: jest.fn(({ where, data }: any) => {
        const article = articles.find((a) => a.id === where.id);
        if (!article) throw new Error('Artikel nicht im Mock gefunden');
        Object.assign(article, data);
        return Promise.resolve(article);
      }),
    },
    auditLog: {
      create: jest.fn(({ data }: any) => {
        auditLogs.push(data);
        return Promise.resolve(data);
      }),
    },
    $transaction: jest.fn((ops: Promise<any>[]) => Promise.all(ops)),
    __auditLogs: auditLogs,
  };
}

describe('DataGuardianService.applyPriceList', () => {
  it('legt neue Artikel an, aktualisiert geänderte und protokolliert beides im AuditLog', async () => {
    const prisma = createPrismaMock();
    const service = new DataGuardianService(prisma as any);

    const result = await service.applyPriceList('company-a', 'user-1', [
      { articleNumber: 'A-1', name: 'Schotter', unit: 'Sack', purchasePrice: 6, salePrice: 9 }, // Preisänderung
      { articleNumber: 'A-2', name: 'Splitt', unit: 'Sack', purchasePrice: 2, salePrice: 4 }, // neu
    ]);

    expect(result.createdCount).toBe(1);
    expect(result.updatedCount).toBe(1);

    const logs = (prisma as any).__auditLogs;
    expect(logs.some((l: any) => l.action === 'price_list_import_update' && l.source === 'import')).toBe(
      true,
    );
    expect(logs.some((l: any) => l.action === 'price_list_import_create' && l.source === 'import')).toBe(
      true,
    );
  });

  it('schreibt nichts und protokolliert nichts, wenn es keine Änderungen gibt', async () => {
    const prisma = createPrismaMock();
    const service = new DataGuardianService(prisma as any);

    const result = await service.applyPriceList('company-a', 'user-1', [
      { articleNumber: 'A-1', name: 'Schotter', unit: 'Sack', purchasePrice: 5, salePrice: 8 },
    ]);

    expect(result.createdCount).toBe(0);
    expect(result.updatedCount).toBe(0);
    expect((prisma as any).__auditLogs).toHaveLength(0);
  });
});

describe('DataGuardianService.applyPriceList – zeilenweise Auswahl', () => {
  it('übernimmt nur die in acceptedArticleNumbers gelisteten Änderungen', async () => {
    const prisma = createPrismaMock();
    const service = new DataGuardianService(prisma as any);

    const result = await service.applyPriceList(
      'company-a',
      'user-1',
      [
        { articleNumber: 'A-1', name: 'Schotter', unit: 'Sack', purchasePrice: 6, salePrice: 9 }, // Preisänderung
        { articleNumber: 'A-2', name: 'Splitt', unit: 'Sack', purchasePrice: 2, salePrice: 4 }, // neu
        { articleNumber: 'A-3', name: 'Rindenmulch', unit: 'Sack', purchasePrice: 3, salePrice: 6 }, // neu
      ],
      ['A-2'], // nur A-2 übernehmen, A-1 und A-3 werden übersprungen
    );

    expect(result.createdCount).toBe(1); // nur A-2
    expect(result.updatedCount).toBe(0); // A-1 wurde NICHT übernommen
    expect(result.skippedCount).toBe(2); // A-1 (Update) + A-3 (neu)
  });

  it('übernimmt bei leerer acceptedArticleNumbers-Liste gar nichts', async () => {
    const prisma = createPrismaMock();
    const service = new DataGuardianService(prisma as any);

    const result = await service.applyPriceList(
      'company-a',
      'user-1',
      [{ articleNumber: 'A-2', name: 'Splitt', unit: 'Sack', purchasePrice: 2, salePrice: 4 }],
      [], // explizit nichts ausgewählt
    );

    expect(result.createdCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });

  it('ohne acceptedArticleNumbers bleibt das bisherige Verhalten (alles übernehmen)', async () => {
    const prisma = createPrismaMock();
    const service = new DataGuardianService(prisma as any);

    const result = await service.applyPriceList('company-a', 'user-1', [
      { articleNumber: 'A-2', name: 'Splitt', unit: 'Sack', purchasePrice: 2, salePrice: 4 },
      { articleNumber: 'A-3', name: 'Rindenmulch', unit: 'Sack', purchasePrice: 3, salePrice: 6 },
    ]);

    expect(result.createdCount).toBe(2);
    expect(result.skippedCount).toBe(0);
  });
});
