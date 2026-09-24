import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AddressInfo } from 'net';
import request from 'supertest';
import { createDemo } from '../../src/cli/demo-data';
import { createApp, resetDatabase } from './helpers';

// Demo für Vorführungen (docker-compose.demo.yml): legt den Musterbetrieb über
// die echte API an – bricht eine API-Änderung die Demo, fällt es hier auf.
describe('Demo', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let base: string;
  const api = () => request(app.getHttpServer());
  const env = { ...process.env };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    process.env = env;
    await app.close();
  });

  it('Demo-Infos nur mit DEMO_MODE', async () => {
    delete process.env.DEMO_MODE;
    await api().get('/demo/info').expect(404);
    process.env.DEMO_MODE = '1';
    process.env.DEMO_URLS = 'http://192.168.1.20:8080, javascript:alert(1),https://10.0.0.5:8443';
    const info = await api().get('/demo/info').expect(200);
    expect(info.body).toMatchObject({
      urls: ['http://192.168.1.20:8080', 'https://10.0.0.5:8443'],
      password: 'demo12345',
    });
    expect(info.body.logins).toHaveLength(3);
  });

  it('legt die Demo an, einmal', async () => {
    const lines: string[] = [];
    expect(await createDemo(prisma, base, (line) => lines.push(line))).toMatchObject({ created: true });
    const companyId = 'demo-company-id';
    expect(await prisma.customer.count({ where: { companyId } })).toBe(5);
    expect(await prisma.invoice.count({ where: { companyId, status: 'issued' } })).toBe(2);
    expect(await prisma.invoicePayment.count({ where: { companyId } })).toBe(1);
    expect(await prisma.maintenanceContract.count({ where: { companyId } })).toBe(1);
    expect(await prisma.projectMessage.count({ where: { companyId } })).toBe(2);
    expect(await prisma.appointment.count({ where: { companyId } })).toBeGreaterThan(6);

    // alle drei Zugänge melden sich an; der Mitarbeiter hat heute Termine auf der Baustelle
    for (const email of [
      'admin@musterbetrieb.de',
      'buero@musterbetrieb.de',
      'mitarbeiter@musterbetrieb.de',
    ]) {
      await api().post('/auth/login').send({ email, password: 'demo12345' }).expect(201);
    }
    const worker = await api()
      .post('/auth/login')
      .send({ email: 'mitarbeiter@musterbetrieb.de', password: 'demo12345' });
    const today = await api()
      .get('/site/today')
      .set({ Authorization: `Bearer ${worker.body.accessToken}` })
      .expect(200);
    expect(today.body.appointments.length).toBeGreaterThanOrEqual(2);
    // keine Preise für den Mitarbeiter
    await api()
      .get('/open-items')
      .set({ Authorization: `Bearer ${worker.body.accessToken}` })
      .expect(403);

    // zweiter Lauf: nichts doppelt
    expect(await createDemo(prisma, base, () => undefined)).toMatchObject({ created: false });
    expect(await prisma.customer.count({ where: { companyId } })).toBe(5);
  });
});
