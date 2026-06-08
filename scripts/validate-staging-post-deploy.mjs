#!/usr/bin/env node
/** Pós-deploy staging: emit=1 + __memedDiagnosticLog do app implantado. */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const AT = 'c302bd9e-060a-4ee8-b4cf-0c78392f60c6';
const PANEL = 'https://painel-medico-staging-staging.up.railway.app';
const BACKEND = 'https://mdoctor-backend-staging-staging.up.railway.app';
const REPORT = path.join('docs', 'MEMED-STAGING-DEPLOY-9127d96-VALIDACAO.json');
const SHOT = path.join('docs', 'MEMED-STAGING-DEPLOY-9127d96-VALIDACAO.png');

const envPath = path.join('mdoctor-panel', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const USER = process.env.TOUR_LOGIN_USER || 'drmax.matos';
const PASS = process.env.MEDICO_PASS || process.env.TOUR_LOGIN_PASS || '';

function summarize(log, mod, cmd) {
  const after = log.filter((e) => e.phase === 'after' && e.module === mod && e.command === cmd);
  const before = log.filter((e) => e.phase === 'before' && e.module === mod && e.command === cmd);
  const last = after[after.length - 1];
  const payload = last?.payload ?? before[before.length - 1]?.payload;
  if (!last) return { outcome: before.length ? 'PENDENTE' : 'NAO_EXECUTADO', payload };
  return {
    outcome: last.ok ? 'OK' : last.timed_out ? 'TIMEOUT' : 'ERRO',
    duration_ms: last.duration_ms,
    payload,
    error: last.error,
  };
}

async function main() {
  if (!PASS) throw new Error('MEDICO_PASS required');

  const login = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: USER, password: PASS }),
  }).then((r) => r.json());

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.addInitScript(({ jwt, user }) => {
    localStorage.setItem('mdoctor_auth_token', jwt);
    localStorage.setItem('mdoctor_auth_user', JSON.stringify(user));
  }, { jwt: login.token, user: login.user });

  const url = `${PANEL}/receita?atendimentoId=${AT}&emit=1`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByText('Prescrição digital', { exact: true }).waitFor({ timeout: 60000 });

  try {
    await page.waitForFunction(
      () => {
        const t = document.body.innerText;
        return (
          /Prescrição aberta|Revise e assine|Tempo esgotado|Não foi possível/i.test(t) ||
          (window.__memedDiagnosticLog || []).some(
            (e) => e.phase === 'after' && e.module === 'plataforma.prescricao' && e.command === 'addItem' && e.ok,
          )
        );
      },
      undefined,
      { timeout: 120000 },
    );
  } catch {
    // captura estado parcial após timeout de abertura
  }

  await page.waitForTimeout(3000);

  const diagnosticLog = await page.evaluate(() => window.__memedDiagnosticLog || []);
  const statusLines = await page.evaluate(() =>
    document.body.innerText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /Prescrição|Revise|Tempo esgotado|Losartana|Aplicando|Abrindo|medicamento/i.test(l))
      .slice(0, 12),
  );
  const ui = await page.evaluate(() => ({
    iframeCount: document.querySelectorAll('iframe').length,
    mdHub: Boolean(window.MdHub?.command?.send),
  }));

  const report = {
    generated_at: new Date().toISOString(),
    deployed_commit: '9127d96',
    deployment_id: 'f418342e-a737-4859-be6f-3c4f47b91171',
    panel_url: PANEL,
    validated_url: url,
    status_lines: statusLines,
    commands: {
      getUsuario: summarize(diagnosticLog, 'plataforma.usuario', 'getUsuario'),
      setPaciente: summarize(diagnosticLog, 'plataforma.prescricao', 'setPaciente'),
      newPrescription: summarize(diagnosticLog, 'plataforma.prescricao', 'newPrescription'),
      addItem: summarize(diagnosticLog, 'plataforma.prescricao', 'addItem'),
      show: { outcome: ui.iframeCount > 0 ? 'OK' : 'INDETERMINADO', iframeCount: ui.iframeCount },
    },
    diagnostic_log_count: diagnosticLog.length,
    diagnostic_log: diagnosticLog,
    ui,
  };

  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  await page.screenshot({ path: SHOT, fullPage: false });
  console.log(JSON.stringify(report.commands, null, 2));
  console.log('report:', REPORT);
  console.log('screenshot:', SHOT);

  await browser.close();

  const requiredOk = ['setPaciente', 'newPrescription', 'addItem'];
  for (const cmd of requiredOk) {
    if (report.commands[cmd]?.outcome !== 'OK') {
      console.error(`FALHA: ${cmd}`, report.commands[cmd]);
      process.exit(1);
    }
  }
  if (report.commands.setPaciente?.payload?.cpf) process.exit(1);
  if (report.commands.show?.iframeCount < 1) {
    console.error('FALHA: show/widget sem iframe');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
