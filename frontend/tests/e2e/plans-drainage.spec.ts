import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { API_BASE_URL, SEED, apiLogin, loginViaUi } from './fixtures';

// Entwässerung aus der Skizze: Bögen, Abzweige, Anschlussrohre, Schachttiefe
// in der Mengenliste und als Einkaufsliste (CSV). 1 m = 50 Planeinheiten.
test('Lageplan: Formstücke der Entwässerung und Einkaufsliste', async ({ page, request }) => {
  const token = await apiLogin(request);
  const headers = { Authorization: `Bearer ${token}` };
  const m = (x: number, y: number) => [x * 50, y * 50];
  const plan = await (
    await request.post(`${API_BASE_URL}/projects/${SEED.projectId}/plans`, {
      headers,
      data: { name: `Entwässerung ${Date.now().toString().slice(-6)}` },
    })
  ).json();
  const saved = await request.put(`${API_BASE_URL}/plans/${plan.id}`, {
    headers,
    data: {
      version: plan.version,
      objects: [
        {
          id: 'rw',
          type: 'rainwater',
          points: [m(2, 2), m(12, 2), m(12, 10)],
          props: { dn: 150, depth: 0.8 },
        },
        { id: 'fr', type: 'downpipe', points: [m(6, 2)] },
        { id: 'pf', type: 'paving', points: [m(4, 0), m(8, 0), m(8, 4), m(4, 4)], props: { height: 0.2 } },
        { id: 'lr', type: 'conduit', points: [m(2, 12), m(10, 12)], props: { dn: 50 } },
        { id: 'hs', type: 'building', points: [m(14, 0), m(20, 0), m(20, 6), m(14, 6)] },
      ],
    },
  });
  expect(saved.ok()).toBe(true);

  await loginViaUi(page);
  await page.goto(`/projekte/${SEED.projectId}/plaene/${plan.id}`);
  const table = page.getByTestId('plan-quantities');
  await expect(table).toContainText('Regenwasser: Bogen 87° DN 150');
  await expect(table).toContainText('Regenwasser: Abzweig DN 150');
  // Fallrohr auf Pflaster +0,20: Anschlussrohr 0,80 + 0,20 = 1,00 m
  await expect(table.getByRole('row', { name: /Anschlussrohr senkrecht DN 150/ })).toContainText('1,00 m');
  await expect(table).toContainText('Leerrohr DN 50');
  await expect(table).not.toContainText('Gebäude');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('plan-quantities-csv').click(),
  ]);
  const csv = readFileSync((await download.path())!, 'utf8');
  expect(csv).toContain('Position;Menge;Einheit');
  expect(csv).toContain('"Regenwasser: Bogen 87° DN 150";2;Stk');
});
