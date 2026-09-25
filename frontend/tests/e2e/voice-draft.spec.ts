import { test, expect } from '@playwright/test';
import { API_BASE_URL, apiLogin, loginViaUi, SEED } from './fixtures';

// Sprachbefehle: die Spracherkennung des Browsers wird durch eine Attrappe
// ersetzt, die den Text aus window.__voiceText "hört"
test('Sprachbefehle: einschalten, Bereich öffnen, suchen', async ({ page }) => {
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = '';
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        setTimeout(() => {
          const transcript = (window as unknown as { __voiceText: string }).__voiceText;
          this.onresult?.({ results: [[{ transcript }]] });
          this.onend?.();
        }, 20);
      }
      stop() {
        this.onend?.();
      }
    }
    // neuere Chromium-Versionen haben auch die Form ohne Präfix
    const w = window as unknown as { webkitSpeechRecognition: unknown; SpeechRecognition: unknown };
    w.webkitSpeechRecognition = FakeRecognition;
    w.SpeechRecognition = FakeRecognition;
  });
  await loginViaUi(page);
  await expect(page.getByTestId('voice-button')).toHaveCount(0);
  await page.goto('/einstellungen');
  await page.getByTestId('voice-toggle').check();

  const say = async (text: string) => {
    await page.evaluate((t) => ((window as unknown as { __voiceText: string }).__voiceText = t), text);
    await page.getByTestId('voice-button').click();
  };
  await say('Öffne die Plantafel');
  await expect(page).toHaveURL(/\/plantafel$/);
  await expect(page.getByTestId('voice-feedback')).toContainText('Plantafel');
  await say('Suche nach Müller');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue('müller');
  await page.keyboard.press('Escape');
  await say('Blumen gießen');
  await expect(page.getByTestId('voice-feedback')).toContainText('kein Befehl erkannt');
});

// Plantafel-Entwurf: verschieben erst im Entwurf, Konflikt sehen, übernehmen
test('Plantafel-Entwurf: was wäre wenn, dann übernehmen', async ({ page, request }) => {
  const run = Date.now().toString().slice(-6);
  const token = await apiLogin(request);
  const headers = { Authorization: `Bearer ${token}` };
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + 14); // übernächste Woche
  monday.setHours(8, 0, 0, 0);
  const created = await request.post(`${API_BASE_URL}/appointments`, {
    headers,
    data: {
      projectId: SEED.projectId,
      title: `Entwurf ${run}`,
      startTime: monday.toISOString(),
      endTime: new Date(monday.getTime() + 3 * 3_600_000).toISOString(),
    },
  });
  expect(created.ok()).toBeTruthy();
  const appointment = await created.json();

  try {
    await loginViaUi(page);
    await page.goto('/plantafel');
    await page.getByTestId('board-next').click();
    await page.getByTestId('board-next').click();
    await page.getByTestId('board-draft-toggle').click();
    await expect(page.getByTestId('board-draft-count')).toContainText('0 Änderungen');

    // Projekt um 2 Tage verschieben – nur im Entwurf
    await page.getByTestId('board-shift-project').selectOption(SEED.projectId);
    await page.getByTestId('board-shift-days').fill('2');
    await page.getByTestId('board-shift').click();
    await expect(page.getByTestId('board-draft-count')).not.toContainText('0 Änderungen');
    const wednesday = new Date(monday);
    wednesday.setDate(monday.getDate() + 2);
    const iso = `${wednesday.getFullYear()}-${String(wednesday.getMonth() + 1).padStart(2, '0')}-${String(wednesday.getDate()).padStart(2, '0')}`;
    const item = page.getByTestId('board-item').filter({ hasText: `Entwurf ${run}` });
    await expect(item).toHaveClass(/is-draft/);
    await expect(item.locator('xpath=ancestor::td')).toHaveAttribute('data-day', iso);
    // der Server kennt den Entwurf noch nicht
    const before = await (
      await request.get(`${API_BASE_URL}/appointments/by-project/${SEED.projectId}`, { headers })
    ).json();
    expect(before.find((a: { id: string }) => a.id === appointment.id).startTime).toBe(appointment.startTime);

    await page.getByTestId('board-draft-apply').click();
    await expect(page.getByTestId('board-notice')).toContainText('Entwurf übernommen');
    const after = await (
      await request.get(`${API_BASE_URL}/appointments/by-project/${SEED.projectId}`, { headers })
    ).json();
    expect(new Date(after.find((a: { id: string }) => a.id === appointment.id).startTime).getDate()).toBe(
      wednesday.getDate(),
    );
  } finally {
    await request.patch(`${API_BASE_URL}/appointments/${appointment.id}/status`, {
      headers,
      data: { status: 'cancelled' },
    });
  }
});
