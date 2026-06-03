import fs from 'node:fs';
import path from 'node:path';
import {
  CONSOLE_JSON,
  HARDENING_REPORT_PATH,
  NETWORK_JSON,
  PANEL_URL,
  REPORT_PATH,
  SCREENSHOT_DIR,
} from './panel-config';

export type ConsoleEntry = { type: string; text: string };

export type ScreenEntry = { name: string; file: string; url: string };

export type TourEntry = {
  route: string;
  url: string;
  ok: boolean;
  heading: string | null;
  token: string;
  issues: string[];
};

export type LoginReport = {
  ok: boolean;
  steps: Record<string, unknown>[];
  token_saved?: boolean;
  redirect_url?: string;
  redirect_ok?: boolean;
  visible_error?: string | null;
};

export type TourReportData = {
  generated_at: string;
  mode: string;
  panel_url: string;
  backend_url: string;
  login_user: string;
  headless: boolean;
  slow_mo: number;
  viewport: { width: number; height: number };
  playwright_artifacts: string;
  login: LoginReport;
  console_log: ConsoleEntry[];
  console_errors: string[];
  network: unknown[];
  screens: ScreenEntry[];
  tour: TourEntry[];
  blockers: string[];
  notes: string[];
  trace_hint: string;
};

export function ensureTourDirs() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

export function slug(name: string) {
  return name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

export function writeTourArtifacts(report: TourReportData) {
  fs.writeFileSync(NETWORK_JSON, JSON.stringify(report.network, null, 2), 'utf8');
  fs.writeFileSync(CONSOLE_JSON, JSON.stringify(report.console_log, null, 2), 'utf8');

  const lines = [
    '# Painel Médico — Tour Visual E2E (Playwright Test)',
    '',
    `> ${report.generated_at}`,
    `> Navegador: Playwright Chromium ${report.headless ? 'headless' : '**headed (janela real)**'}`,
    `> Viewport: ${report.viewport.width}×${report.viewport.height} (notebook)`,
    `> slowMo: ${report.slow_mo}ms · trace/screenshot/video: **on**`,
    `> Painel: ${PANEL_URL}`,
    `> Artefatos Playwright: \`${report.playwright_artifacts}\``,
    `> Login testado: \`${report.login_user}\``,
    '',
    '## Resumo',
    '',
    '| Item | Resultado |',
    '|------|-----------|',
    `| Login UI real | ${report.login.ok ? '✅ OK' : '❌ FALHOU'} |`,
    `| POST /api/auth/login | ${report.login.steps.find((s) => s.step === 'login_request')?.status ?? '—'} |`,
    `| Token localStorage | ${report.login.token_saved ? '✅' : '❌'} |`,
    `| Redirect | ${report.login.redirect_ok ? report.login.redirect_url : '❌'} |`,
    `| Telas tour | ${report.tour.length} |`,
    `| Console errors | ${report.console_errors.length} |`,
    '',
    '## Artefatos auditáveis',
    '',
    `- Screenshots numerados: \`docs/screenshots/painel-tour/\``,
    `- Traces / vídeos / screenshots automáticos: \`${report.playwright_artifacts}/test-results/\``,
    `- Relatório HTML: \`${report.playwright_artifacts}/html-report/index.html\``,
    `- Trace Viewer: \`npm run tour-trace -- <caminho>/trace.zip\``,
    `- [network-log.json](screenshots/painel-tour/network-log.json) · [console-log.json](screenshots/painel-tour/console-log.json)`,
    '',
  ];

  if (report.blockers.length) {
    lines.push('## Blockers', '');
    report.blockers.forEach((b) => lines.push(`- ${b}`));
    lines.push('');
  }

  lines.push('## Login (JSON)', '', '```json', JSON.stringify(report.login, null, 2), '```', '');

  if (report.console_errors.length) {
    lines.push('## Console errors', '');
    report.console_errors.forEach((e) => lines.push(`- \`${e}\``));
    lines.push('');
  }

  lines.push('## Screenshots reais', '');
  report.screens.forEach((s) => lines.push(`- [${path.basename(s.file)}](${s.file}) — \`${s.url}\``));
  lines.push('', report.trace_hint, '');

  if (!report.login.ok) {
    lines.push(
      '## Correção necessária',
      '',
      '1. `railway login`',
      '2. `MEDICO_PASS=... node mdoctor-panel/scripts/apply-painel-definitivo-railway.js`',
      '3. Aguardar redeploy (~3 min)',
      '4. `TOUR_LOGIN_PASS=... npm run tour-visual`',
      '',
    );
  }

  fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');

  const loginOk = report.login.ok;
  const hardening = [
    '# Painel Médico — Hardening Final',
    '',
    `> Gerado em: ${report.generated_at}`,
    `> Painel: ${PANEL_URL}`,
    '',
    '## Checklist operacional',
    '',
    '| Item | Status |',
    '|------|--------|',
    `| Login único | ${loginOk ? '✅' : '❌'} |`,
    `| JWT + redirect /fila | ${report.login.redirect_ok ? '✅' : '❌'} |`,
    `| Tour visual (${report.tour.length} telas) | ${report.tour.length >= 4 ? '✅' : '⚠️'} |`,
    `| Console errors | ${report.console_errors.length === 0 ? '✅ nenhum' : `⚠️ ${report.console_errors.length}`} |`,
    '',
    '## Screenshots',
    '',
    ...report.screens.map((s) => `- [${path.basename(s.file)}](${s.file})`),
    '',
    'Detalhes: [PAINEL-TOUR-VISUAL-RELATORIO.md](PAINEL-TOUR-VISUAL-RELATORIO.md)',
    '',
  ];
  fs.writeFileSync(HARDENING_REPORT_PATH, hardening.join('\n'), 'utf8');
}
