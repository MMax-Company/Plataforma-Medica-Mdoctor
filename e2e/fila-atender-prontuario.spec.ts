import { test, expect } from '@playwright/test';
import { BACKEND_URL, LOGIN_PASS, LOGIN_USER, PANEL_URL } from './helpers/panel-config';

test.describe('Fila — botão Atender abre prontuário', () => {
  test.beforeAll(() => {
    if (!LOGIN_PASS) test.skip(true, 'MEDICO_PASS obrigatório');
  });

  test('ATENDER navega para /atendimento/[id]', async ({ page }) => {
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
    const homolog = (queueBody.atendimentos || []).find((a: { paciente_nome?: string; id?: string }) =>
      String(a.paciente_nome || '').includes('PACIENTE TESTE 01'),
    );
    test.skip(!homolog?.id, 'PACIENTE TESTE 01 não encontrado na fila');

    await page.goto(`${PANEL_URL}/login`);
    await page.locator('input[type="password"]').fill(LOGIN_PASS);
    await page.locator('input[autocomplete="username"], input[type="text"]').first().fill(LOGIN_USER);
    await page.getByRole('button', { name: /acessar painel/i }).click();
    await page.waitForURL(/\/fila/, { timeout: 30_000 });

    const atenderBtn = page.getByRole('button', { name: /^ATENDER$/i }).first();
    await expect(atenderBtn).toBeVisible({ timeout: 20_000 });
    await atenderBtn.click();

    await page.waitForURL(new RegExp(`/atendimento/${homolog.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), {
      timeout: 30_000,
    });
    await expect(page.getByText(/PACIENTE TESTE 01/i).first()).toBeVisible({ timeout: 20_000 });
  });
});
