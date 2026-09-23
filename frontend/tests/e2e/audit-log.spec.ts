import { test, expect } from '@playwright/test';
import { SEED, loginViaUi } from './fixtures';

// Eine Änderung in der Oberfläche erscheint im Protokoll (Einstellungen).
test.describe('Protokoll', () => {
  test('ein Statuswechsel am Projekt steht mit Name und alt → neu im Protokoll', async ({ page }) => {
    await loginViaUi(page);
    await page.goto(`/projekte/${SEED.projectId}`);
    const status = page.getByTestId('project-status-select');
    const current = await status.inputValue();
    const next = current === 'in_progress' ? 'open' : 'in_progress';
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/projects/${SEED.projectId}/status`)),
      status.selectOption(next),
    ]);

    await page.getByTestId('nav-settings').click();
    const log = page.getByTestId('audit-log');
    await log.getByTestId('audit-filter').selectOption('Project');
    const newest = log.getByTestId('audit-entry').first();
    await expect(newest).toContainText('Projektstatus');
    const label: Record<string, string> = {
      open: 'Offen',
      in_progress: 'In Arbeit',
      done: 'Fertig',
      cancelled: 'Storniert',
    };
    await expect(newest).toContainText(`Status: ${label[current]} → ${label[next]}`);
    await expect(newest).toContainText('Max Mustermann');
  });
});
