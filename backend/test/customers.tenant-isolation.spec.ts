import { NotFoundException } from '@nestjs/common';
import { CustomersService } from '../src/customers/customers.service';

// Minimaler Prisma-Mock: simuliert zwei Firmen mit jeweils einem Kunden.
function createPrismaMock() {
  const customers = [
    { id: 'cust-a', companyId: 'company-a', name: 'Kunde von Firma A', properties: [] },
    { id: 'cust-b', companyId: 'company-b', name: 'Kunde von Firma B', properties: [] },
  ];

  return {
    customer: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(customers.filter((c) => c.companyId === where.companyId)),
      ),
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(customers.find((c) => c.id === where.id && c.companyId === where.companyId) ?? null),
      ),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'new-id', ...data })),
    },
  };
}

describe('CustomersService – Mandantentrennung', () => {
  it('findAll liefert nur Kunden der eigenen Firma', async () => {
    const prisma = createPrismaMock();
    const service = new CustomersService(prisma as any);

    const result = await service.findAll('company-a');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('cust-a');
  });

  it('findOne wirft NotFoundException, wenn der Kunde einer anderen Firma gehört', async () => {
    const prisma = createPrismaMock();
    const service = new CustomersService(prisma as any);

    // Firma A versucht, auf den Kunden von Firma B zuzugreifen.
    await expect(service.findOne('company-a', 'cust-b')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findOne findet den eigenen Kunden korrekt', async () => {
    const prisma = createPrismaMock();
    const service = new CustomersService(prisma as any);

    const result = await service.findOne('company-b', 'cust-b');
    expect(result.id).toBe('cust-b');
  });
});
