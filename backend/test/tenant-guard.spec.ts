import { assertTenantFilter, filtersByCompany, TenantFilterMissingError } from '../src/prisma/tenant-guard';

describe('Mandanten-Guard', () => {
  it('erkennt den companyId-Filter direkt, in AND und in jedem OR-Zweig', () => {
    expect(filtersByCompany({ companyId: 'a' })).toBe(true);
    expect(filtersByCompany({ AND: [{ status: 'open' }, { companyId: 'a' }] })).toBe(true);
    expect(filtersByCompany({ AND: { companyId: 'a' } })).toBe(true);
    expect(filtersByCompany({ OR: [{ companyId: 'a' }, { companyId: 'b', id: 'x' }] })).toBe(true);
  });

  it('ohne Filter, mit leerem Wert oder mit nur einem OR-Zweig: kein Mandantenfilter', () => {
    expect(filtersByCompany(undefined)).toBe(false);
    expect(filtersByCompany({ id: 'x' })).toBe(false);
    expect(filtersByCompany({ companyId: undefined })).toBe(false);
    expect(filtersByCompany({ OR: [{ companyId: 'a' }, { id: 'x' }] })).toBe(false);
    expect(filtersByCompany({ OR: [] })).toBe(false);
  });

  it('sperrt Listen- und Massenabfragen auf Mandanten-Tabellen ohne Filter', () => {
    for (const action of ['findMany', 'findFirst', 'count', 'updateMany', 'deleteMany']) {
      expect(() => assertTenantFilter({ model: 'Invoice', action, args: {} })).toThrow(
        TenantFilterMissingError,
      );
    }
    expect(() =>
      assertTenantFilter({ model: 'Invoice', action: 'findMany', args: { where: { companyId: 'a' } } }),
    ).not.toThrow();
  });

  it('lässt Einzelzugriffe per id und Tabellen ohne companyId durch', () => {
    expect(() =>
      assertTenantFilter({ model: 'Invoice', action: 'findUnique', args: { where: { id: 'x' } } }),
    ).not.toThrow();
    expect(() =>
      assertTenantFilter({ model: 'Invoice', action: 'update', args: { where: { id: 'x' } } }),
    ).not.toThrow();
    expect(() =>
      assertTenantFilter({ model: 'InvoiceLineItem', action: 'findMany', args: {} }),
    ).not.toThrow();
    expect(() => assertTenantFilter({ model: 'Permission', action: 'findMany', args: {} })).not.toThrow();
  });
});
