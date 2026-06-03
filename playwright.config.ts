import { defineConfig } from '@playwright/test';
import path from 'node:path';

const isCI = process.env.CI === 'true' || process.env.CI === '1';
const headless =
  isCI || process.env.HEADLESS === '1' || process.env.HEADLESS === 'true';
const artifactsDir = path.join('docs', 'playwright-artifacts');

/**
 * Tour visual do painel médico — experiência auditável (headed, trace, vídeo, slowMo).
 * Spec: e2e/painel-tour.spec.ts
 *
 *   npm run tour-visual
 *   npm run tour-trace -- docs/playwright-artifacts/test-results/.../trace.zip
 *   npm run tour-report
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: path.join(artifactsDir, 'test-results'),
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(artifactsDir, 'html-report'), open: 'never' }],
    ['json', { outputFile: path.join(artifactsDir, 'report.json') }],
  ],

  use: {
    baseURL: (process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app').replace(
      /\/$/,
      '',
    ),
    headless,
    trace: 'on',
    screenshot: 'on',
    video: 'on',
    viewport: { width: 1366, height: 768 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    launchOptions: {
      slowMo: isCI ? 0 : Number(process.env.SLOW_MO || 300),
      devtools: !isCI,
    },
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },

  projects: [
    {
      name: 'painel-tour-chromium',
      testMatch: /painel-tour\.spec\.ts/,
    },
    {
      name: 'memed-hardening-chromium',
      testMatch: /memed-human-hardening\.spec\.ts/,
    },
    {
      name: 'painel-funcional-chromium',
      testMatch: /painel-funcional\.spec\.ts/,
    },
    {
      name: 'fila-atender-chromium',
      testMatch: /fila-atender-prontuario\.spec\.ts/,
    },
  ],
});
