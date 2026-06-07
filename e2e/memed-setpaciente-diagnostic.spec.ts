import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { BACKEND_URL, LOGIN_PASS, LOGIN_USER, PANEL_URL } from './helpers/panel-config';

const ATENDIMENTO_ID = process.env.ATENDIMENTO_ID || 'c302bd9e-060a-4ee8-b4cf-0c78392f60c6';
const REPORT_JSON = path.join(__dirname, '../docs/MEMED-SETPACIENTE-DIAGNOSTICO.json');

type DiagnosticEntry = {
  phase: string;
  module: string;
  command: string;
  method: string;
  payload?: unknown;
  response?: unknown;
  duration_ms?: number;
  ok?: boolean;
  error?: string;
  timed_out?: boolean;
};

function summarizeCommand(log: DiagnosticEntry[], module: string, command: string) {
  const before = log.filter((e) => e.phase === 'before' && e.module === module && e.command === command);
  const after = log.filter((e) => e.phase === 'after' && e.module === module && e.command === command);
  const lastBefore = before[before.length - 1];
  const lastAfter = after[after.length - 1];

  if (lastBefore && !lastAfter) {
    const started = Date.parse(lastBefore.at || '');
    return {
      status: 'PENDENTE' as const,
      method: lastBefore.method,
      payload: lastBefore.payload,
      response: null,
      duration_ms: Number.isFinite(started) ? Date.now() - started : undefined,
      error: 'Promise não resolveu — comando iniciou mas não retornou',
    };
  }

  if (!lastAfter) return { status: 'NAO_EXECUTADO' as const };
  return {
    status: lastAfter.ok ? ('OK' as const) : lastAfter.timed_out ? ('TIMEOUT' as const) : ('ERRO' as const),
    duration_ms: lastAfter.duration_ms,
    payload: lastAfter.payload ?? lastBefore?.payload,
    response: lastAfter.response,
    error: lastAfter.error,
    method: lastAfter.method,
  };
}

async function apiLogin() {
  const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: LOGIN_USER, password: LOGIN_PASS }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error(data.error || `login ${res.status}`);
  return { token: data.token as string, user: data.user };
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
}

test.describe('Diagnóstico setPaciente Memed', () => {
  test.beforeAll(() => {
    if (!LOGIN_PASS) test.skip(true, 'MEDICO_PASS obrigatório');
  });

  test('captura getUsuario → setPaciente → newPrescription → addItem', async ({ page }) => {
    const session = await apiLogin();

    await page.addInitScript(({ jwt, user }) => {
      localStorage.setItem('mdoctor_auth_token', jwt);
      localStorage.setItem('mdoctor_auth_user', JSON.stringify(user));
    }, { jwt: session.token, user: session.user });

    await page.addInitScript(() => {
      type Entry = {
        id: string;
        at: string;
        phase: 'before' | 'after';
        module: string;
        command: string;
        method: 'MdHub.command.send';
        payload?: unknown;
        response?: unknown;
        duration_ms?: number;
        ok?: boolean;
        error?: string;
      };

      (window as unknown as { __memedDiagnosticLog?: Entry[] }).__memedDiagnosticLog = [];

      const push = (entry: Entry) => {
        (window as unknown as { __memedDiagnosticLog: Entry[] }).__memedDiagnosticLog.push(entry);
      };

      const serialize = (value: unknown) => {
        try {
          return JSON.parse(JSON.stringify(value));
        } catch {
          return String(value);
        }
      };

      const wrapMdHub = () => {
        const hub = window.MdHub;
        if (!hub?.command?.send || (hub.command.send as { __dpDiag?: boolean }).__dpDiag) return false;

        const original = hub.command.send.bind(hub.command);
        hub.command.send = async (module: string, command: string, payload?: unknown) => {
          const id = `${module}.${command}-${Date.now()}`;
          const started = performance.now();
          push({
            id: `${id}-before`,
            at: new Date().toISOString(),
            phase: 'before',
            module,
            command,
            method: 'MdHub.command.send',
            payload: serialize(payload),
          });

          try {
            const response = await original(module, command, payload);
            push({
              id: `${id}-after`,
              at: new Date().toISOString(),
              phase: 'after',
              module,
              command,
              method: 'MdHub.command.send',
              payload: serialize(payload),
              response: serialize(response),
              duration_ms: Math.round(performance.now() - started),
              ok: true,
            });
            return response;
          } catch (err) {
            push({
              id: `${id}-after`,
              at: new Date().toISOString(),
              phase: 'after',
              module,
              command,
              method: 'MdHub.command.send',
              payload: serialize(payload),
              duration_ms: Math.round(performance.now() - started),
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
            throw err;
          }
        };
        (hub.command.send as { __dpDiag?: boolean }).__dpDiag = true;
        return true;
      };

      const timer = setInterval(() => {
        if (wrapMdHub()) clearInterval(timer);
      }, 100);
    });

    const sessionForFetch = session;
    const attRes = await fetch(`${BACKEND_URL}/api/atendimentos/${ATENDIMENTO_ID}`, {
      headers: { Authorization: `Bearer ${sessionForFetch.token}` },
    });
    const attBody = await attRes.json();
    expect(attRes.ok).toBeTruthy();
    const atendimento = attBody.atendimento || attBody;

    await page.goto(`${PANEL_URL}/receita?atendimentoId=${ATENDIMENTO_ID}&emit=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await expect(page.getByText('Prescrição digital', { exact: true })).toBeVisible({ timeout: 30_000 });

    const emitBtn = page.getByRole('button', { name: /^Emitir Receita$/i }).first();
    const autoOpened = await emitBtn.isDisabled().catch(() => false);
    if (!autoOpened && (await emitBtn.isEnabled().catch(() => false))) {
      await emitBtn.click();
    }

    await page.waitForTimeout(70_000);

    const diagnosticLog = await page.evaluate(() => {
      return (window as unknown as { __memedDiagnosticLog?: DiagnosticEntry[] }).__memedDiagnosticLog || [];
    });

    const panelDiagnosticLog = await page.evaluate(() => {
      return (window as unknown as { __memedDiagnosticLog?: DiagnosticEntry[] }).__memedDiagnosticLog || [];
    });

    const statusLines = await page
      .locator('body')
      .innerText()
      .then((t) =>
        t
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => /Prescrição|Tempo esgotado|Aplicando|Revise|Memed|Emitir|Abrindo|Token|timeout/i.test(line))
          .slice(0, 15),
      );

    const iframeCount = await page.locator('iframe').count();

    const report = {
      generated_at: new Date().toISOString(),
      atendimentoId: ATENDIMENTO_ID,
      paciente: atendimento?.paciente_nome,
      atendimento_status: atendimento?.status,
      panel_url: PANEL_URL,
      timeouts: {
        setPaciente_ms: 30_000,
        openPrescription_ms: 45_000,
        setPaciente_had_timeout_before_diagnostic: 'sim — código novo adiciona timeout 30s por comando; staging atual ainda sem deploy',
      },
      expected_setPaciente_payload: {
        nome: atendimento?.paciente_nome,
        telefone: String(atendimento?.paciente_telefone || '').replace(/\D/g, '') || '11999999999',
        idExterno: ATENDIMENTO_ID,
        cpf: String(atendimento?.paciente_cpf || '').replace(/\D/g, '') || undefined,
      },
      page_status_lines: statusLines,
      diagnostic_log: diagnosticLog.length ? diagnosticLog : panelDiagnosticLog,
      resumo: {
        getUsuario: summarizeCommand(
          diagnosticLog.length ? diagnosticLog : panelDiagnosticLog,
          'plataforma.usuario',
          'getUsuario',
        ),
        setPaciente: summarizeCommand(
          diagnosticLog.length ? diagnosticLog : panelDiagnosticLog,
          'plataforma.prescricao',
          'setPaciente',
        ),
        newPrescription: summarizeCommand(
          diagnosticLog.length ? diagnosticLog : panelDiagnosticLog,
          'plataforma.prescricao',
          'newPrescription',
        ),
        addItem: summarizeCommand(
          diagnosticLog.length ? diagnosticLog : panelDiagnosticLog,
          'plataforma.prescricao',
          'addItem',
        ),
      },
      ui: {
        iframe_count: iframeCount,
        mdHub_present: await page.evaluate(() => Boolean(window.MdHub?.command?.send)),
      },
    };

    fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');

    console.log('DIAGNOSTICO MEMED:', JSON.stringify(report.resumo, null, 2));

    expect(report.resumo.getUsuario.status, JSON.stringify(report.resumo.getUsuario)).toBe('OK');
    expect(report.resumo.setPaciente.status, JSON.stringify(report.resumo.setPaciente)).toBe('OK');
    expect(report.resumo.newPrescription.status, JSON.stringify(report.resumo.newPrescription)).toBe('OK');
    expect(report.resumo.addItem.status, JSON.stringify(report.resumo.addItem)).toBe('OK');
  });
});
