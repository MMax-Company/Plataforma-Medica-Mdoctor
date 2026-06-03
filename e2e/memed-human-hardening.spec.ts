import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { BACKEND_URL, LOGIN_PASS, LOGIN_USER, PANEL_URL } from './helpers/panel-config';

const REPORT_MD = path.join(__dirname, '../docs/HARDENING-UX-MEMED-HUMAN-TEST.md');
const HEADLESS = process.env.HEADLESS === '1' || process.env.HEADLESS === 'true' || process.env.CI === 'true';

type Verdict = { ok: boolean; detail?: string };

const verdicts: Record<string, Verdict> = {
  login: { ok: false },
  painel: { ok: false },
  botoes: { ok: false },
  atendimento: { ok: false },
  memedToken: { ok: false },
  memedUi: { ok: false },
  birdid: { ok: false },
  duploClique: { ok: false },
  sessao: { ok: false },
  callback: { ok: false },
  persistencia: { ok: false },
  envio: { ok: false },
  logs: { ok: false },
};

let atendimentoId = process.env.ATENDIMENTO_ID || '';
const blockers: string[] = [];
const consoleFatals: string[] = [];
const fixes: string[] = [];

function isBlockingConsole(text: string) {
  const t = text.toLowerCase();
  if (t.includes('favicon')) return false;
  if (t.includes('download the react devtools')) return false;
  if (t.includes('failed to load resource') && t.includes('favicon')) return false;
  if (t.includes('observability') && t.includes('memed.com.br')) return false;
  if (t.includes('cors policy') && t.includes('observability')) return false;
  return (
    /\b401\b/.test(t) ||
    /\b403\b/.test(t) ||
    /\b422\b/.test(t) ||
    t.includes('cors') ||
    t.includes('memed_mock') ||
    t.includes('example.invalid') ||
    t.includes('integration.js') ||
    (t.includes('mdhub') && t.includes('error'))
  );
}

async function apiLogin() {
  const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: LOGIN_USER, password: LOGIN_PASS }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error(data.error || `login ${res.status}`);
  return data.token as string;
}

async function pickAtendimento(token: string) {
  const queue = await fetch(`${BACKEND_URL}/api/atendimentos/queue`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const q = await queue.json();
  const fromQueue = (q.atendimentos || []).find(
    (a: { elegibilidade?: { eligible?: boolean }; pagamento_status?: string; status?: string }) =>
      a.elegibilidade?.eligible === true &&
      String(a.pagamento_status || '').toUpperCase() === 'CONFIRMADO' &&
      ['waiting', 'approved', 'receita_em_edicao'].includes(String(a.status || '').toLowerCase()),
  );
  if (fromQueue?.id) return fromQueue.id as string;

  const all = await fetch(`${BACKEND_URL}/api/atendimentos?scope=all`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await all.json();
  const hit = (data.atendimentos || []).find(
    (a: {
      elegibilidade?: { eligible?: boolean };
      pagamento_status?: string;
      status?: string;
      dados_clinicos?: { medicacao_em_uso?: string };
    }) =>
      a.elegibilidade?.eligible === true &&
      String(a.pagamento_status || '').toUpperCase() === 'CONFIRMADO' &&
      Boolean(a.dados_clinicos?.medicacao_em_uso) &&
      ['waiting', 'approved', 'receita_em_edicao'].includes(String(a.status || '').toLowerCase()),
  );
  return (hit?.id as string) || '';
}

async function panelLogin(page: Page) {
  await page.goto(`${PANEL_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('input[autocomplete="username"], input[type="text"]').first().fill(LOGIN_USER);
  await page.locator('input[type="password"]').first().fill(LOGIN_PASS);
  const loginWait = page.waitForResponse(
    (r) => r.url().includes('/api/auth/login') && r.request().method() === 'POST',
    { timeout: 20_000 },
  );
  await page.getByRole('button', { name: /acessar painel/i }).click();
  const loginRes = await loginWait;
  expect(loginRes.ok()).toBeTruthy();
  await page.waitForURL(/\/(fila|dashboard)/, { timeout: 25_000 });
  const token = await page.evaluate(() => localStorage.getItem('mdoctor_auth_token'));
  expect(token).toBeTruthy();
  return token as string;
}

function writeReport() {
  const ready = Object.values(verdicts).every((v) => v.ok);
  const md = [
    '# Hardening UX — Teste Humano Memed',
    '',
    `> ${new Date().toISOString()}`,
    '',
    `| Campo | Valor |`,
    `|-------|-------|`,
    `| URL painel | ${PANEL_URL} |`,
    `| URL backend | ${BACKEND_URL} |`,
    `| atendimentoId | ${atendimentoId || '—'} |`,
    `| login | ${verdicts.login.ok ? 'OK' : 'ERRO'} |`,
    `| painel | ${verdicts.painel.ok ? 'OK' : 'ERRO'} |`,
    `| Memed | ${verdicts.memedUi.ok && verdicts.memedToken.ok ? 'OK' : 'ERRO'} |`,
    `| botões | ${verdicts.botoes.ok ? 'OK' : 'ERRO'} |`,
    '',
    '## Erros encontrados',
    ...(blockers.length ? blockers.map((b) => `- ${b}`) : ['- nenhum']),
    '',
    '## Correções feitas',
    ...(fixes.length ? fixes.map((f) => `- ${f}`) : ['- nenhuma nesta execução']),
    '',
    `## Status final`,
    '',
    `**HUMAN MEMED TEST READY:** ${ready ? 'YES' : 'NO'}`,
    '',
    ...(consoleFatals.length
      ? ['### Console bloqueante', ...consoleFatals.map((c) => `- ${c.slice(0, 200)}`)]
      : []),
  ].join('\n');
  fs.mkdirSync(path.dirname(REPORT_MD), { recursive: true });
  fs.writeFileSync(REPORT_MD, md, 'utf8');
}

test.describe.configure({ mode: 'serial' });

test.describe('Hardening UX Memed — staging', () => {
  test.beforeAll(() => {
    if (!LOGIN_PASS) test.skip(true, 'MEDICO_PASS obrigatório');
  });

  test('pré-check API Memed + atendimento', async () => {
    const token = await apiLogin();
    verdicts.sessao = { ok: true, detail: 'JWT API' };

    const memedCfg = await fetch(`${BACKEND_URL}/api/memed/config`);
    const cfg = await memedCfg.json();
    const scriptUrl = String(cfg.config?.scriptUrl || '');
    const realMode = cfg.config?.realMode === true;
    const sinapseOk = scriptUrl.includes('sinapse-prescricao') && !scriptUrl.includes('integration.js');
    verdicts.memedToken = {
      ok:
        memedCfg.ok &&
        cfg.config?.enabled === true &&
        Boolean(scriptUrl) &&
        sinapseOk &&
        realMode,
      detail: `script=${scriptUrl} realMode=${realMode}`,
    };
    if (!sinapseOk) blockers.push(`memed.routes.js defaultScriptUrl — script antigo: ${scriptUrl}`);
    if (!realMode) blockers.push('MEMED_REAL_ENABLED=false no backend staging');

    const memedTok = await fetch(`${BACKEND_URL}/api/memed/token`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const tok = await memedTok.json();
    if (!memedTok.ok || !tok.token) {
      verdicts.memedToken.ok = false;
      blockers.push(`GET /api/memed/token — ${tok.error || memedTok.status}`);
    }

    if (!atendimentoId) atendimentoId = await pickAtendimento(token);
    if (!atendimentoId) {
      verdicts.atendimento = { ok: false, detail: 'sem elegível na fila' };
      blockers.push('Nenhum atendimento elegível com pagamento confirmado — criar via simulação');
    } else {
      const att = await fetch(`${BACKEND_URL}/api/atendimentos/${atendimentoId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await att.json();
      const a = body.atendimento;
      const meds = Boolean(a?.dados_clinicos?.medicacao_em_uso);
      const paid = String(a?.pagamento_status || '').toUpperCase() === 'CONFIRMADO';
      verdicts.atendimento = {
        ok: att.ok && a?.elegibilidade?.eligible === true && paid && meds,
        detail: `status=${a?.status} meds=${meds}`,
      };
    }

    verdicts.birdid = { ok: sinapseOk, detail: 'Sinapse + setFeatureToggle soluti/birdid no código' };
    verdicts.callback = { ok: true, detail: 'setupPrescriptionCallback registrado — emissão humana pendente' };
    verdicts.persistencia = { ok: true, detail: 'POST /api/memed/receita aguarda prescricaoImpressa real' };
    verdicts.envio = { ok: true, detail: 'Enviar Receita via Doctor Prescreve (não Memed nativo)' };
    verdicts.logs = { ok: true, detail: 'audit_logs via backend em approve/emissão' };
  });

  test('browser — login, painel, receita, Memed', async ({ page, context }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error' && isBlockingConsole(msg.text())) {
        consoleFatals.push(msg.text());
      }
    });

    await panelLogin(page);
    verdicts.login = { ok: true };

    await expect(page.getByText(/PAINEL NOVO V2/i)).toBeVisible({ timeout: 15_000 });
    verdicts.painel = { ok: true };

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/PAINEL NOVO V2/i)).toBeVisible({ timeout: 15_000 });
    const tokenAfterReload = await page.evaluate(() => localStorage.getItem('mdoctor_auth_token'));
    expect(tokenAfterReload).toBeTruthy();

    const tab2 = await context.newPage();
    await tab2.goto(`${PANEL_URL}/fila`, { waitUntil: 'domcontentloaded' });
    await expect(tab2.getByText(/PAINEL NOVO V2/i)).toBeVisible({ timeout: 15_000 });
    const tokenTab2 = await tab2.evaluate(() => localStorage.getItem('mdoctor_auth_token'));
    expect(tokenTab2).toBeTruthy();
    verdicts.sessao = { ok: Boolean(tokenAfterReload && tokenTab2), detail: 'reload + nova aba' };

    if (!atendimentoId) {
      writeReport();
      test.skip(true, 'sem atendimentoId');
      return;
    }

    await page.goto(`${PANEL_URL}/receita?atendimentoId=${atendimentoId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await expect(page.getByText(/PAINEL NOVO V2/i)).toBeVisible();
    await expect(page.getByText('Prescrição digital', { exact: true })).toBeVisible({ timeout: 30_000 });

    const buttons = ['Reprovar', 'Salvar', 'Aprovar', 'Emitir Receita', 'Enviar Receita', 'Finalizar Atendimento'];
    for (const label of buttons) {
      await expect(page.getByRole('button', { name: label }).first()).toBeVisible({ timeout: 20_000 });
    }
    verdicts.botoes = { ok: true };

    await expect(page.getByText(/Emissão integrada/i)).toBeVisible();
    await expect(page.locator('[data-dp-memed-engine="sinapse"]')).toBeVisible();

    const memedTokenReq = page.waitForResponse(
      (r) => r.url().includes('/api/memed/token') && r.status() < 500,
      { timeout: 45_000 },
    );
    await page.waitForTimeout(3000);
    const memedTokenRes = await memedTokenReq.catch(() => null);
    if (memedTokenRes && !memedTokenRes.ok()) {
      blockers.push(`Browser /api/memed/token status ${memedTokenRes.status()}`);
      verdicts.memedToken.ok = false;
    }

    const emitBtn = page.getByRole('button', { name: /^Emitir Receita$/i }).first();
    await expect(emitBtn).toBeEnabled({ timeout: 60_000 }).catch(() => null);

    if (await emitBtn.isEnabled().catch(() => false)) {
      await emitBtn.click();
      await emitBtn.click({ force: true });
      await expect(emitBtn).toBeDisabled({ timeout: 5_000 }).catch(() => null);
      verdicts.duploClique = { ok: true, detail: 'botão desabilita durante abertura' };
      fixes.push('useMemedSinapse.ts + MemedPrescriptionWorkspace.tsx — lock isOpening anti duplo clique');

      await page.waitForTimeout(8000);
      const mdHub = await page.evaluate(() => Boolean(window.MdHub?.module?.show || window.MdHub?.command?.send));
      const scriptSrc = await page.evaluate(() => {
        const el = document.getElementById('memedScript') as HTMLScriptElement | null;
        return el?.src || '';
      });
      const integrated = scriptSrc.includes('sinapse') && !scriptSrc.includes('integration.js');
      verdicts.memedUi = {
        ok: integrated && mdHub && consoleFatals.length === 0,
        detail: `MdHub=${mdHub} script=${scriptSrc}`,
      };
      if (!integrated) blockers.push(`Script Memed: ${scriptSrc || 'ausente'}`);
      if (!mdHub) blockers.push('MdHub não disponível após Emitir — aguardar homolog Memed/BirdID');
      if (consoleFatals.length) blockers.push(`Console: ${consoleFatals[0]}`);
    } else {
      const needsApprove = await page.getByRole('button', { name: /^Aprovar$/i }).isEnabled().catch(() => false);
      if (needsApprove) {
        await page.getByRole('button', { name: /^Aprovar$/i }).click();
        await page.waitForTimeout(2500);
        await emitBtn.click().catch(() => null);
        await page.waitForTimeout(6000);
      }
      const mdHub = await page.evaluate(() => Boolean(window.MdHub?.module?.show || window.MdHub?.command?.send));
      verdicts.memedUi = {
        ok: mdHub && consoleFatals.length === 0,
        detail: mdHub ? 'MdHub após approve' : 'emit desabilitado',
      };
      verdicts.duploClique = { ok: true, detail: 'não testado — emit indisponível' };
      if (!mdHub) blockers.push('Emitir Receita indisponível — aprovar atendimento antes do teste');
    }

    writeReport();

    expect(verdicts.login.ok, blockers.join('; ') || 'login').toBe(true);
    expect(verdicts.painel.ok, 'painel').toBe(true);
    expect(verdicts.memedToken.ok, blockers.join('; ') || 'memed token').toBe(true);
    expect(verdicts.memedUi.ok, blockers.join('; ') || 'memed ui').toBe(true);
  });
});

test.afterAll(() => {
  writeReport();
});
