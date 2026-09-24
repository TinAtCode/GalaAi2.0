import { defineConfig } from 'vitest/config';

// Unit-Tests für reine Logik (Geometrie, DXF-Import). Die Playwright-Tests
// unter tests/e2e laufen getrennt (npm run test:e2e).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
