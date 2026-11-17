import { defineConfig } from '@playwright/test';

const PORT = 3210;

/**
 * Tests de bout en bout en mode FIXTURE=1 (aucun réseau, aucune clé), sur le build de production
 * (`npm run web:build` d'abord), à 390 px, en clair et en sombre.
 */
export default defineConfig({
  testDir: './e2e',
  reporter: 'list',
  fullyParallel: true,
  workers: 2,
  outputDir: '../../out/web-e2e',
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 },
  projects: [
    { name: 'clair', use: { colorScheme: 'light' } },
    { name: 'sombre', use: { colorScheme: 'dark' } },
  ],
  webServer: {
    command: `npx next start -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/login`,
    // FIXTURE_ALLOW_START : accord explicite, sans lequel `next start` refuse le mode fixture.
    env: { FIXTURE: '1', FIXTURE_ALLOW_START: '1', NEXT_TELEMETRY_DISABLED: '1' },
    reuseExistingServer: false,
    timeout: 60_000,
  },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' } },
});
