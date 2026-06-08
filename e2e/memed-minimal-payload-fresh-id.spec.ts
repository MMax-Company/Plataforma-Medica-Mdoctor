import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { BACKEND_URL, LOGIN_PASS, LOGIN_USER, PANEL_URL } from './helpers/panel-config';

const ATENDIMENTO_ID = process.env.ATENDIMENTO_ID || 'c302bd9e-060a-4ee8-b4cf-0c78392f60c6';
const ID_EXTERNO = process.env.MEMED_TEST_ID_EXTERNO || ATENDIMENTO_ID;
const REPORT_JSON = path.join(__dirname, '../docs/MEMED-PAYLOAD-MINIMO-VALIDACAO-FRESH-ID.json');
const CMD_TIMEOUT_MS = Number(process.env.MEMED_CMD_TIMEOUT_MS || 20_000);

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

test('fluxo Memed payload mínimo — idExterno fresco', async ({ page }) => {
  test.setTimeout(240_000);
  if (!LOGIN_PASS) test.skip(true, 'MEDICO_PASS obrigatório');

  const login = await apiLogin();
  const setPacientePayload = {
    nome: 'PACIENTE TESTE 05',
    telefone: '11988700005',
    idExterno: ID_EXTERNO,
  };
  const addItemPayload = {
    nome: 'Losartana 50mg',
    posologia: 'Tomar 1 comprimido por via oral a cada 24 horas. Uso contínuo.',
    quantidade: 30,
  };

  await page.addInitScript(({ jwt, user }) => {
    localStorage.setItem('mdoctor_auth_token', jwt);
    localStorage.setItem('mdoctor_auth_user', JSON.stringify(user));
  }, { jwt: login.token, user: login.user });

  await page.goto(`${PANEL_URL}/receita?atendimentoId=${ATENDIMENTO_ID}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForFunction(() => Boolean(window.MdHub?.command?.send && window.MdSinapsePrescricao), undefined, {
    timeout: 180_000,
  });
  await page.waitForTimeout(5000);

  const results = await page.evaluate(
    async ({ cmdTimeoutMs, setPaciente, addItem }) => {
      const mod = 'plataforma.prescricao';
      const run = async (command: string, payload?: unknown) => {
        const started = performance.now();
        try {
          const response = await Promise.race([
            window.MdHub!.command.send(mod, command, payload),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('TIMEOUT')), cmdTimeoutMs),
            ),
          ]);
          return {
            command,
            outcome: 'OK' as const,
            duration_ms: Math.round(performance.now() - started),
            payload,
            response,
          };
        } catch (e) {
          return {
            command,
            outcome: (e instanceof Error && e.message === 'TIMEOUT' ? 'TIMEOUT' : 'REJECT') as
              | 'TIMEOUT'
              | 'REJECT',
            duration_ms: Math.round(performance.now() - started),
            payload,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      };

      const flow = [];
      flow.push(await run('setPaciente', setPaciente));
      flow.push(await run('newPrescription'));
      flow.push(await run('addItem', addItem));
      try {
        window.MdHub!.module.show(mod);
        flow.push({ command: 'show', outcome: 'OK' as const, duration_ms: 0 });
      } catch (e) {
        flow.push({
          command: 'show',
          outcome: 'REJECT' as const,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      flow.push(await run('getUsuario'));
      return flow;
    },
    { cmdTimeoutMs: CMD_TIMEOUT_MS, setPaciente: setPacientePayload, addItem: addItemPayload },
  );

  const report = {
    generated_at: new Date().toISOString(),
    atendimentoId: ATENDIMENTO_ID,
    idExterno_tested: ID_EXTERNO,
    note: 'idExterno fresco evita hang de re-bind Memed no mesmo paciente já vinculado hoje',
    panel_url: PANEL_URL,
    setPaciente_payload: setPacientePayload,
    addItem_payload: addItemPayload,
    flow: results,
  };

  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.flow, null, 2));

  const byCmd = (c: string) => results.find((r) => r.command === c);
  expect(byCmd('setPaciente')?.outcome).toBe('OK');
  expect(byCmd('newPrescription')?.outcome).toBe('OK');
  expect(byCmd('addItem')?.outcome).toBe('OK');
  expect(byCmd('show')?.outcome).toBe('OK');
});
