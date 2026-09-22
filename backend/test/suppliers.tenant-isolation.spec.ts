import { NotFoundException } from '@nestjs/common';
import { SuppliersService } from '../src/suppliers/suppliers.service';

function createPrismaMock() {
  const suppliers = [
    { id: 'sup-a', companyId: 'company-a', name: 'Lieferant von Firma A' },
    { id: 'sup-b', companyId: 'company-b', name: 'Lieferant von Firma B' },
  ];

  return {
    supplier: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(suppliers.filter((s) => s.companyId === where.companyId)),
      ),
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(suppliers.find((s) => s.id === where.id && s.companyId === where.companyId) ?? null),
      ),
    },
  };
}

describe('SuppliersService – Mandantentrennung', () => {
  it('findAll liefert nur Lieferanten der eigenen Firma', async () => {
    const prisma = createPrismaMock();
    const service = new SuppliersService(prisma as any);

    const result = await service.findAll('company-a');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('sup-a');
  });

  it('findOne wirft NotFoundException bei fremder Firma', async () => {
    const prisma = createPrismaMock();
    const service = new SuppliersService(prisma as any);

    await expect(service.findOne('company-a', 'sup-b')).rejects.toBeInstanceOf(NotFoundException);
  });
});
