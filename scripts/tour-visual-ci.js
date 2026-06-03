#!/usr/bin/env node
/** Tour visual em modo CI (headless). */
process.env.CI = '1';
require('child_process').execSync('npx playwright test e2e/painel-tour.spec.ts', {
  stdio: 'inherit',
  cwd: require('path').resolve(__dirname, '..'),
});
