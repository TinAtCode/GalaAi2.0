import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RolesService } from '../src/roles/roles.service';

function createPrismaMock() {
  const permissions = [
    { id: 'perm-1', key: 'customer.read' },
    { id: 'perm-2', key: 'price.sale.read' },
  ];
  const roles = [{ id: 'role-a', companyId: 'company-a', name: 'Büro' }];
  const users = [
    { id: 'user-a', companyId: 'company-a' },
    { id: 'user-b', companyId: 'company-b' },
  ];
  const rolePermissions: any[] = [];

  return {
    permission: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(permissions.filter((p) => where.key.in.includes(p.key))),
      ),
    },
    role: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(roles.find((r) => r.id === where.id && r.companyId === where.companyId) ?? null),
      ),
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve({ ...roles.find((r) => r.id === where.id), permissions: rolePermissions }),
      ),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'new-role', ...data })),
    },
    user: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(users.find((u) => u.id === where.id && u.companyId === where.companyId) ?? null),
      ),
    },
    rolePermission: {
      deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
      createMany: jest.fn(({ data }: any) => {
        rolePermissions.push(...data);
        return Promise.resolve({ count: data.length });
      }),
    },
    userRole: {
      upsert: jest.fn(({ create }: any) => Promise.resolve(create)),
    },
    $transaction: jest.fn((ops: Promise<any>[]) => Promise.all(ops)),
  };
}

describe('RolesService', () => {
  it('wirft BadRequestException bei unbekanntem Permission-Key', async () => {
    const prisma = createPrismaMock();
    const service = new RolesService(prisma as any);

    await expect(
      service.create('company-a', { name: 'Test', permissionKeys: ['does.not.exist'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('legt eine Rolle mit gültigen Permission-Keys an', async () => {
    const prisma = createPrismaMock();
    const service = new RolesService(prisma as any);

    const role = await service.create('company-a', {
      name: 'Büro',
      permissionKeys: ['customer.read', 'price.sale.read'],
    });
    expect(role.id).toBe('new-role');
  });

  it('assignToUser schlägt fehl, wenn der User einer anderen Firma gehört', async () => {
    const prisma = createPrismaMock();
    const service = new RolesService(prisma as any);

    await expect(service.assignToUser('company-a', 'role-a', 'user-b')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('assignToUser funktioniert innerhalb derselben Firma', async () => {
    const prisma = createPrismaMock();
    const service = new RolesService(prisma as any);

    const result = await service.assignToUser('company-a', 'role-a', 'user-a');
    expect(result).toEqual({ userId: 'user-a', roleId: 'role-a' });
  });
});
