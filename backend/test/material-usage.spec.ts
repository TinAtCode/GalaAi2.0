import { NotFoundException } from '@nestjs/common';
import { MaterialUsageService } from '../src/material-usage/material-usage.service';

function createPrismaMock() {
  const projects = [{ id: 'proj-a', property: { customer: { companyId: 'company-a' } } }];
  const articles = [{ id: 'art-a', companyId: 'company-a' }];

  return {
    project: {
      findFirst: jest.fn(({ where }: any) => {
        if (where.id !== 'proj-a') return Promise.resolve(null);
        const requiredCompanyId = where.companyId;
        if (requiredCompanyId && requiredCompanyId !== 'company-a') return Promise.resolve(null);
        return Promise.resolve(projects[0]);
      }),
    },
    article: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(articles.find((a) => a.id === where.id && a.companyId === where.companyId) ?? null),
      ),
    },
    projectMaterialUsage: {
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'usage-1', ...data })),
      findMany: jest.fn(() => Promise.resolve([])),
    },
  };
}

describe('MaterialUsageService', () => {
  it('lehnt Buchung an einem fremden Projekt ab', async () => {
    const prisma = createPrismaMock();
    const service = new MaterialUsageService(prisma as any);

    await expect(
      service.record('company-b', 'user-1', { projectId: 'proj-a', articleId: 'art-a', quantity: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lehnt Buchung mit einem Artikel einer fremden Firma ab', async () => {
    const prisma = createPrismaMock();
    const service = new MaterialUsageService(prisma as any);

    await expect(
      service.record('company-a', 'user-1', {
        projectId: 'proj-a',
        articleId: 'does-not-exist',
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('bucht erfolgreich innerhalb derselben Firma', async () => {
    const prisma = createPrismaMock();
    const service = new MaterialUsageService(prisma as any);

    const usage = await service.record('company-a', 'user-1', {
      projectId: 'proj-a',
      articleId: 'art-a',
      quantity: 3,
    });
    expect(usage.id).toBe('usage-1');
    expect(usage.recordedByUserId).toBe('user-1');
  });
});
