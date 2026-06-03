import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { BACKEND_URL, LOGIN_PASS, LOGIN_USER, PANEL_URL } from './helpers/panel-config';

const REPORT = path.join(__dirname, '../docs/PAINEL-FUNCIONAL-VALIDACAO.md');

test.describe('Painel funcional staging', () => {
  test.beforeAll(() => {
    if (!LOGIN_PASS) test.skip(true, 'MEDICO_PASS obrigatório');
  });

  test('fila mostra pacientes elegíveis após login', async ({ page }) => {
    const loginRes = await page.request.post(`${BACKEND_URL}/api/auth/login`, {
      data: { user: LOGIN_USER, password: LOGIN_PASS },
    });
    expect(loginRes.ok()).toBeTruthy();
    const { token } = await loginRes.json();

    const queueRes = await page.request.get(`${BACKEND_URL}/api/atendimentos/queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(queueRes.ok()).toBeTruthy();
    const queueBody = await queueRes.json();
    const eligible = (queueBody.atendimentos || []).filter(
      (a: { elegibilidade?: { eligible?: boolean }; pagamento_status?: string }) =>
        a.elegibilidade?.eligible === true && String(a.pagamento_status || '').toUpperCase() === 'CONFIRMADO',
    );
    expect(eligible.length).toBeGreaterThanOrEqual(1);

    await page.goto(`${PANEL_URL}/login`);
    await page.locator('input[type="password"]').fill(LOGIN_PASS);
    await page.locator('input[autocomplete="username"], input[type="text"]').first().fill(LOGIN_USER);
    await page.getByRole('button', { name: /acessar painel/i }).click();
    await page.waitForURL(/\/fila/, { timeout: 30_000 });
    await expect(page.getByText(/PAINEL NOVO V2/i)).toBeVisible();

    const firstName = eligible[0]?.paciente_nome?.split(' ').slice(0, 2).join(' ');
    if (firstName) {
      await expect(
        page.getByText(new RegExp(firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).first(),
      ).toBeVisible({
        timeout: 20_000,
      });
    }

    const append = [
      '',
      '## Playwright',
      `- fila UI: ${eligible.length} elegíveis na API, primeiro visível: ${firstName || 'n/a'}`,
      `- URL: ${PANEL_URL}/fila`,
    ].join('\n');
    fs.appendFileSync(REPORT, append, 'utf8');
  });
});
