import path from 'node:path';

export const REPO_ROOT = path.resolve(__dirname, '../..');

export const PANEL_URL = (process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app').replace(
  /\/$/,
  '',
);
export const BACKEND_URL = (process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(
  /\/$/,
  '',
);

export const LOGIN_USER = process.env.TOUR_LOGIN_USER || 'drmax.matos';
export const LOGIN_PASS = process.env.TOUR_LOGIN_PASS || process.env.MEDICO_PASS || '';

export const SCREENSHOT_DIR = path.join(REPO_ROOT, 'docs/screenshots/painel-tour');
export const ARTIFACTS_DIR = path.join(REPO_ROOT, 'docs/playwright-artifacts');
export const REPORT_PATH = path.join(REPO_ROOT, 'docs/PAINEL-TOUR-VISUAL-RELATORIO.md');
export const HARDENING_REPORT_PATH = path.join(REPO_ROOT, 'docs/PAINEL-HARDENING-FINAL.md');
export const NETWORK_JSON = path.join(SCREENSHOT_DIR, 'network-log.json');
export const CONSOLE_JSON = path.join(SCREENSHOT_DIR, 'console-log.json');
