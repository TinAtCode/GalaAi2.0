import { NotFoundException } from '@nestjs/common';
import { PropertiesService } from '../src/properties/properties.service';
import { ProjectsService } from '../src/projects/projects.service';

// Simuliert: Firma A hat Kunde -> Objekt -> Projekt. Firma B versucht,
// über die bekannte propertyId/projectId an fremde Daten zu kommen.
function createPrismaMock() {
  const customers = [{ id: 'cust-a', companyId: 'company-a' }];
  const properties = [{ id: 'prop-a', customerId: 'cust-a', customer: customers[0] }];
  const projects = [{ id: 'proj-a', propertyId: 'prop-a', property: properties[0], status: 'open' }];

  return {
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    customer: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(customers.find((c) => c.id === where.id && c.companyId === where.companyId) ?? null),
      ),
    },
    property: {
      findFirst: jest.fn(({ where }: any) => {
        // Filter über die direkte companyId des Objekts
        const byId = properties.find((p) => p.id === where.id);
        if (!byId) return Promise.resolve(null);
        const companyId = where.companyId;
        if (companyId && byId.customer.companyId !== companyId) return Promise.resolve(null);
        return Promise.resolve(byId);
      }),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'new-prop', ...data })),
    },
    project: {
      count: jest.fn(() => Promise.resolve(0)),
      findFirst: jest.fn(({ where }: any) => {
        const byId = projects.find((p) => p.id === where.id);
        if (!byId) return Promise.resolve(null);
        const companyId = where.companyId;
        if (companyId && byId.property.customer.companyId !== companyId) return Promise.resolve(null);
        return Promise.resolve(byId);
      }),
      findMany: jest.fn(({ where }: any) => {
        if (where.propertyId) {
          return Promise.resolve(projects.filter((p) => p.propertyId === where.propertyId));
        }
        const companyId = where.companyId;
        return Promise.resolve(projects.filter((p) => p.property.customer.companyId === companyId));
      }),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'new-proj', ...data })),
      update: jest.fn(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })),
    },
  };
}

describe('Property/Project – Mandantentrennung über mehrere Ebenen', () => {
  it('Firma B kann kein Objekt einer fremden Firma lesen', async () => {
    const prisma = createPrismaMock();
    const service = new PropertiesService(prisma as any);

    await expect(service.findOne('company-b', 'prop-a')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('Firma A kann ihr eigenes Objekt lesen', async () => {
    const prisma = createPrismaMock();
    const service = new PropertiesService(prisma as any);

    const result = await service.findOne('company-a', 'prop-a');
    expect(result.id).toBe('prop-a');
  });

  it('Firma B kann kein Projekt lesen, das über ein fremdes Objekt/Kunden hängt', async () => {
    const prisma = createPrismaMock();
    const service = new ProjectsService(prisma as any);

    await expect(service.findOne('company-b', 'proj-a')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('Firma B kann kein Projekt an einer fremden propertyId anlegen', async () => {
    const prisma = createPrismaMock();
    const service = new ProjectsService(prisma as any);

    await expect(
      service.create('company-b', { propertyId: 'prop-a', title: 'Unerlaubter Zugriff' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('Firma A kann ein Projekt an ihrem eigenen Objekt anlegen', async () => {
    const prisma = createPrismaMock();
    const service = new ProjectsService(prisma as any);

    const result = await service.create('company-a', { propertyId: 'prop-a', title: 'Neue Terrasse' });
    expect(result.id).toBe('new-proj');
  });

  it('findAllForCompany liefert nur Projekte der eigenen Firma', async () => {
    const prisma = createPrismaMock();
    const service = new ProjectsService(prisma as any);

    const { items: resultA } = await service.findAllForCompany('company-a');
    expect(resultA).toHaveLength(1);
    expect(resultA[0].id).toBe('proj-a');

    const { items: resultB } = await service.findAllForCompany('company-b');
    expect(resultB).toHaveLength(0);
  });
});
