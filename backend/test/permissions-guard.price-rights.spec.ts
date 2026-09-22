import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../src/common/permissions.guard';
import { PERMISSIONS } from '../src/common/permissions';

function createContext(userPermissions: string[], requiredPermissions: string[]) {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(requiredPermissions);

  const request = { user: { permissions: userPermissions } };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;

  return { guard: new PermissionsGuard(reflector), context };
}

describe('PermissionsGuard – Preisrechte', () => {
  it('Mitarbeiter ohne price.purchase.read wird abgelehnt', () => {
    const { guard, context } = createContext(
      [PERMISSIONS.CUSTOMER_READ], // Mitarbeiter: nur Kundendaten, keine Preise
      [PERMISSIONS.PRICE_PURCHASE_READ],
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('Büro-Rolle mit price.sale.read darf Verkaufspreise sehen', () => {
    const { guard, context } = createContext(
      [PERMISSIONS.CUSTOMER_READ, PERMISSIONS.PRICE_SALE_READ],
      [PERMISSIONS.PRICE_SALE_READ],
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('Büro-Rolle ohne price.margin.read darf trotzdem Verkaufspreise sehen (unabhängige Rechte)', () => {
    const { guard, context } = createContext([PERMISSIONS.PRICE_SALE_READ], [PERMISSIONS.PRICE_SALE_READ]);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('Geschäftsführung mit allen Rechten darf Margen sehen', () => {
    const { guard, context } = createContext(
      [PERMISSIONS.PRICE_PURCHASE_READ, PERMISSIONS.PRICE_SALE_READ, PERMISSIONS.PRICE_MARGIN_READ],
      [PERMISSIONS.PRICE_MARGIN_READ],
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('Route ohne @RequirePermissions ist für jeden eingeloggten User offen', () => {
    const { guard, context } = createContext([], []);
    expect(guard.canActivate(context)).toBe(true);
  });
});
