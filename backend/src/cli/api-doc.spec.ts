import { readFileSync } from 'fs';
import { collect, OUTPUT, parseControllers, render } from './api-doc';

describe('API.md', () => {
  it('passt zu den Controllern (sonst: cd backend && npm run docs:api)', () => {
    expect(readFileSync(OUTPUT, 'utf8')).toBe(render(collect(`${__dirname}/../..`)));
  });

  it('liest Pfad, Anmeldung, Rechte, Limit und Kommentar', () => {
    const [doc] = parseControllers(
      'x.controller.ts',
      `
      // Kunden
      @Controller('customers')
      @UseGuards(JwtAuthGuard, PermissionsGuard)
      export class C {
        // eine Liste
        @Get()
        @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
        list() {}

        @Post(':id/merge')
        @Throttle({ default: { limit: 10, ttl: 60000 } })
        @RequirePermissions(PERMISSIONS.CUSTOMER_WRITE, PERMISSIONS.CUSTOMER_DELETE)
        merge() {}

        helper() {}
      }`,
    );
    expect(doc.base).toBe('/customers');
    expect(doc.note).toBe('Kunden');
    expect(doc.endpoints).toEqual([
      expect.objectContaining({
        method: 'GET',
        path: '/customers',
        auth: true,
        permissions: ['customer.read'],
        note: 'eine Liste',
      }),
      expect.objectContaining({
        method: 'POST',
        path: '/customers/:id/merge',
        permissions: ['customer.write', 'customer.delete'],
        throttle: '10 je 60 s',
      }),
    ]);
  });

  it('meldet Schnittstellen ohne Anmeldung', () => {
    const docs = parseControllers(
      'h.controller.ts',
      `@Controller('health') export class H { @Get() ok() {} }
       @Controller('status') export class S { @Get() ok() {} }`,
    );
    expect(docs.map((d) => d.endpoints[0])).toEqual([
      expect.objectContaining({ auth: false, path: '/health' }),
      expect.objectContaining({ auth: false, path: '/status' }),
    ]);
  });
});
