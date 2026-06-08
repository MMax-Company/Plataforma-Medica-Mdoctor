import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { BACKEND_URL, LOGIN_PASS, LOGIN_USER, PANEL_URL } from './helpers/panel-config';

const ATENDIMENTO_ID = process.env.ATENDIMENTO_ID || 'c302bd9e-060a-4ee8-b4cf-0c78392f60c6';
const REPORT_JSON = path.join(__dirname, '../docs/MEMED-PREFILL-CLINICAL-RELATORIO.json');

type MemedCommandLog = {
  command: string;
  payload?: unknown;
  ok: boolean;
  error?: string;
};

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

async function panelLogin(page: Page) {
  await page.goto(`${PANEL_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('input[autocomplete="username"], input[type="text"]').first().fill(LOGIN_USER);
  await page.locator('input[type="password"]').first().fill(LOGIN_PASS);
  await page.getByRole('button', { name: /acessar painel/i }).click();
  await page.waitForURL(/\/(fila|dashboard)/, { timeout: 25_000 });
}

test.describe('Memed — prescrição clínica pré-preenchida', () => {
  test.beforeAll(() => {
    if (!LOGIN_PASS) test.skip(true, 'MEDICO_PASS obrigatório');
  });

  test('captura addItem para atendimento c302bd9e', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __memedCommandLog?: MemedCommandLog[] }).__memedCommandLog = [];
      const wrap = () => {
        const hub = window.MdHub;
        if (!hub?.command?.send || (hub.command.send as { __dpWrapped?: boolean }).__dpWrapped) return false;
        const original = hub.command.send.bind(hub.command);
        hub.command.send = async (module: string, command: string, payload?: unknown) => {
          const entry: MemedCommandLog = { command: `${module}.${command}`, payload, ok: true };
          try {
            const result = await original(module, command, payload);
            (window as unknown as { __memedCommandLog: MemedCommandLog[] }).__memedCommandLog.push(entry);
            return result;
          } catch (err) {
            entry.ok = false;
            entry.error = err instanceof Error ? err.message : String(err);
            (window as unknown as { __memedCommandLog: MemedCommandLog[] }).__memedCommandLog.push(entry);
            throw err;
          }
        };
        (hub.command.send as { __dpWrapped?: boolean }).__dpWrapped = true;
        return true;
      };
      const id = setInterval(() => {
        if (wrap()) clearInterval(id);
      }, 200);
    });

    const token = await apiLogin();
    const attRes = await fetch(`${BACKEND_URL}/api/atendimentos/${ATENDIMENTO_ID}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const attBody = await attRes.json();
    expect(attRes.ok, `atendimento ${ATENDIMENTO_ID}`).toBeTruthy();

    await panelLogin(page);
    await page.goto(`${PANEL_URL}/receita?atendimentoId=${ATENDIMENTO_ID}&emit=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await expect(page.getByText('Prescrição digital', { exact: true })).toBeVisible({ timeout: 30_000 });

    const emitBtn = page.getByRole('button', { name: /^Emitir Receita$/i }).first();
    await expect(emitBtn).toBeEnabled({ timeout: 90_000 }).catch(() => null);

    if (await emitBtn.isEnabled().catch(() => false)) {
      await emitBtn.click();
    } else {
      const approve = page.getByRole('button', { name: /^Aprovar$/i });
      if (await approve.isEnabled().catch(() => false)) {
        await approve.click();
        await page.waitForTimeout(3000);
        await emitBtn.click().catch(() => null);
      }
    }

    await page.waitForTimeout(50_000);

    const commandLog = await page.evaluate(() => (window as unknown as { __memedCommandLog?: MemedCommandLog[] }).__memedCommandLog || []);
    const addItems = commandLog.filter((e) => e.command.endsWith('.addItem'));
    const failed = commandLog.filter((e) => !e.ok);
    const statusText = await page.getByText(/Prescrição aberta|Tempo esgotado|Não foi possível|Abrindo/i).first().textContent().catch(() => '');

    const report = {
      generated_at: new Date().toISOString(),
      atendimentoId: ATENDIMENTO_ID,
      paciente: attBody.atendimento?.paciente_nome,
      panel_url: PANEL_URL,
      status_message: statusText?.trim(),
      commands: commandLog,
      addItem_payloads: addItems.map((e) => e.payload),
      failed_commands: failed,
      prefill_ok: addItems.some((e) => e.ok && e.payload && typeof e.payload === 'object' && 'nome' in (e.payload as object)),
    };

    fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');

    expect(addItems.length, 'nenhum addItem capturado — ver relatório').toBeGreaterThan(0);
    for (const item of addItems) {
      const p = item.payload as Record<string, unknown> | undefined;
      expect(p?.nome, 'addItem.nome').toBeTruthy();
      expect(p?.posologia, 'addItem.posologia').toBeTruthy();
      expect(p?.dose, 'não deve enviar dose à Memed').toBeUndefined();
    }
  });
});
