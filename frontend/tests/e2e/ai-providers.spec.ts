import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { API_BASE_URL, SEED, apiLogin, loginViaUi } from './fixtures';

// Eigenen Agenten einrichten, testen und fragen: der „Agent“ ist ein kleiner
// HTTP-Server in diesem Test (wie ein selbst gehosteter Dienst im LAN).
test.describe('KI-Anbieter', () => {
  test('eigenen Agenten einrichten, testen, fragen und wieder löschen', async ({ page, request }) => {
    const run = String(Date.now()).slice(-6);
    const agent = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const { task, prompt } = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const answers: Record<string, string> = {
          verbindungstest: 'OK',
          angebotstext: `Sehr geehrte Damen und Herren, Anschreiben ${run}`,
          baustelle_zusammenfassung: `- Zusammenfassung ${run}`,
        };
        res.end(JSON.stringify({ text: answers[task] ?? `Antwort ${run}: ${prompt}` }));
      });
    });
    await new Promise<void>((resolve) => agent.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(agent.address() as AddressInfo).port}/agent`;
    const token = await apiLogin(request);
    const headers = { Authorization: `Bearer ${token}` };
    try {
      await loginViaUi(page);
      await page.goto('/einstellungen');
      const section = page.getByTestId('ai-section');
      await section.getByTestId('ai-add').selectOption({ label: 'Eigener Agent (HTTP)' });
      await section.getByTestId('ai-name').fill(`Agent ${run}`);
      await section.getByTestId('ai-baseUrl').fill(url);
      await section.getByTestId('ai-apiKey').fill('geheim');
      await section.getByTestId('ai-isDefault').check();
      await section.getByTestId('ai-save').click();
      const item = section.getByTestId('ai-provider').filter({ hasText: `Agent ${run}` });
      await expect(item).toContainText('Schlüssel hinterlegt');
      await expect(item).toContainText('Standard');

      await item.getByTestId('ai-test').click();
      await expect(item.getByTestId('ai-test-result')).toContainText('✓ Antwort „OK“');

      await section.getByTestId('ai-question').fill('Was steht an?');
      await section.getByTestId('ai-ask').click();
      await expect(section.getByTestId('ai-answer')).toHaveText(
        `Agent ${run}: Antwort ${run}: Was steht an?`,
      );

      // Aufgabe dem Agenten zuordnen (hier gleich dem Standard, mit eigenem Modell)
      const task = section.getByTestId('ai-task-angebotstext');
      await task.getByTestId('ai-task-provider').selectOption({ label: `Agent ${run}` });
      await task.getByTestId('ai-task-model').fill('klein');
      await task.getByTestId('ai-task-save').click();
      await expect(section.getByTestId('ai-message')).toContainText('gespeichert');

      // Anschreiben im Angebot: Vorschlag der KI
      await page.goto(`/projekte/${SEED.projectId}`);
      await page.getByTestId('quote-new').click();
      const form = page.getByTestId('quote-form');
      await form.getByTestId('quote-intro-ai').click();
      await expect(form.getByTestId('quote-intro')).toHaveValue(
        `Sehr geehrte Damen und Herren, Anschreiben ${run}`,
      );
      await form.getByRole('button', { name: 'Abbrechen' }).click();

      // Baustellen-Verlauf zusammenfassen
      await request.post(`${API_BASE_URL}/site/projects/${SEED.projectId}/messages`, {
        headers,
        data: { text: `Hinweis ${run}` },
      });
      await page.reload();
      await page.getByTestId('site-summary').click();
      await expect(page.getByTestId('site-summary-text')).toHaveText(`- Zusammenfassung ${run}`);
    } finally {
      const providers = await (await request.get(`${API_BASE_URL}/ai/providers`, { headers })).json();
      for (const p of providers.filter((p: { name: string }) => p.name === `Agent ${run}`)) {
        await request.delete(`${API_BASE_URL}/ai/providers/${p.id}`, { headers });
      }
      agent.close();
    }
  });
});
