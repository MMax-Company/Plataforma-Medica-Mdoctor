import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { BACKEND_URL, LOGIN_PASS, LOGIN_USER, PANEL_URL } from './helpers/panel-config';

const ATENDIMENTO_ID = process.env.ATENDIMENTO_ID || 'c302bd9e-060a-4ee8-b4cf-0c78392f60c6';
const REPORT_JSON = path.join(__dirname, '../docs/MEMED-PAYLOAD-MINIMO-VALIDACAO.json');
const SCREENSHOT = path.join(__dirname, '../docs/MEMED-PAYLOAD-MINIMO-VALIDACAO.png');
const CMD_TIMEOUT_MS = Number(process.env.MEMED_CMD_TIMEOUT_MS || 30_000);
const PRESCRIPTION_MODULE = 'plataforma.prescricao';

type CmdResult = {
  command: string;
  module: string;
  outcome: 'OK' | 'TIMEOUT' | 'REJECT';
  duration_ms: number;
  payload?: unknown;
  response?: unknown;
  error?: string;
};

/** Espelha buildSetPacientePayload / normalizeNomeForMemedSetPaciente (setMemedPatient.ts). */
function normalizeNomeForMemedSetPaciente(nome: string): string {
  let value = String(nome || '').trim();
  if (!value) return 'Paciente';
  const dashIdx = value.indexOf(' - ');
  if (dashIdx > 0) value = value.slice(0, dashIdx).trim();
  value = value.replace(/\s+/g, ' ').trim();
  if (value.length > 80) value = value.slice(0, 80).trim();
  return value || 'Paciente';
}

function normalizeTelefoneForMemed(value?: string): string {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) digits = digits.slice(2);
  return digits || '11999999999';
}

function buildSetPacientePayloadFromAtendimento(atendimento: Record<string, unknown>) {
  return {
    nome: normalizeNomeForMemedSetPaciente(String(atendimento.paciente_nome || 'Paciente')),
    telefone: normalizeTelefoneForMemed(String(atendimento.paciente_telefone || '')),
    idExterno: ATENDIMENTO_ID,
  };
}

/** Payload addItem esperado para c302bd9e (Losartana 50mg — Fase 1). */
function buildAddItemPayloadFromAtendimento(atendimento: Record<string, unknown>) {
  const med = String(atendimento.medicacao_em_uso || 'Losartana 50mg');
  if (/losartana/i.test(med)) {
    return {
      nome: 'Losartana 50mg',
      posologia: 'Tomar 1 comprimido por via oral a cada 24 horas. Uso contínuo.',
      quantidade: 30,
    };
  }
  return { nome: med, posologia: 'Conforme orientação médica.', quantidade: 30 };
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

test.describe('Validação payload mínimo setPaciente', () => {
  test.beforeAll(() => {
    if (!LOGIN_PASS) test.skip(true, 'MEDICO_PASS obrigatório');
  });

  test('fluxo completo c302bd9e com payload mínimo', async ({ page }) => {
    test.setTimeout(300_000);

    const login = await apiLogin();
    const attRes = await fetch(`${BACKEND_URL}/api/atendimentos/${ATENDIMENTO_ID}`, {
      headers: { Authorization: `Bearer ${login.token}` },
    });
    const attBody = await attRes.json();
    expect(attRes.ok).toBeTruthy();
    const atendimento = (attBody.atendimento || attBody) as Record<string, unknown>;

    const setPacientePayload = buildSetPacientePayloadFromAtendimento(atendimento);
    const addItemPayload = buildAddItemPayloadFromAtendimento(atendimento);

    await page.addInitScript(({ jwt, user }) => {
      localStorage.setItem('mdoctor_auth_token', jwt);
      localStorage.setItem('mdoctor_auth_user', JSON.stringify(user));
    }, { jwt: login.token, user: login.user });

    await page.goto(`${PANEL_URL}/receita?atendimentoId=${ATENDIMENTO_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await expect(page.getByText('Prescrição digital', { exact: true })).toBeVisible({ timeout: 60_000 });

    await page.waitForFunction(
      () => Boolean(window.MdHub?.command?.send && window.MdSinapsePrescricao),
      undefined,
      { timeout: 180_000 },
    );
    await page.waitForTimeout(5000);

    const flowResults = await page.evaluate(
      async ({ cmdTimeoutMs, setPaciente, addItem, prescriptionModule }) => {
        type R = CmdResult;
        const serialize = (v: unknown) => {
          try {
            return JSON.parse(JSON.stringify(v ?? null));
          } catch {
            return String(v);
          }
        };

        async function runCmd(
          module: string,
          command: string,
          payload?: unknown,
        ): Promise<R> {
          const started = performance.now();
          try {
            const response = await Promise.race([
              window.MdHub!.command.send(module, command, payload),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('TIMEOUT')), cmdTimeoutMs),
              ),
            ]);
            return {
              module,
              command,
              outcome: 'OK',
              duration_ms: Math.round(performance.now() - started),
              payload: serialize(payload),
              response: serialize(response),
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              module,
              command,
              outcome: message === 'TIMEOUT' ? 'TIMEOUT' : 'REJECT',
              duration_ms: Math.round(performance.now() - started),
              payload: serialize(payload),
              error: message,
            };
          }
        }

        const results: R[] = [];
        results.push(await runCmd(prescriptionModule, 'setPaciente', setPaciente));
        results.push(await runCmd(prescriptionModule, 'newPrescription'));
        results.push(await runCmd(prescriptionModule, 'addItem', addItem));

        let showOutcome: R = {
          module: 'MdHub.module',
          command: 'show',
          outcome: 'REJECT',
          duration_ms: 0,
          error: 'MdHub.module.show indisponível',
        };
        const showStarted = performance.now();
        try {
          if (window.MdHub?.module?.show) {
            window.MdHub.module.show(prescriptionModule);
            showOutcome = {
              module: 'MdHub.module',
              command: 'show',
              outcome: 'OK',
              duration_ms: Math.round(performance.now() - showStarted),
            };
          }
        } catch (err) {
          showOutcome = {
            module: 'MdHub.module',
            command: 'show',
            outcome: 'REJECT',
            duration_ms: Math.round(performance.now() - showStarted),
            error: err instanceof Error ? err.message : String(err),
          };
        }
        results.push(showOutcome);

        // getUsuario — diagnóstico opcional após fluxo clínico (não faz parte de prepareAndShowPrescription)
        results.push(await runCmd('plataforma.usuario', 'getUsuario'));

        return results;
      },
      {
        cmdTimeoutMs: CMD_TIMEOUT_MS,
        setPaciente: setPacientePayload,
        addItem: addItemPayload,
        prescriptionModule: PRESCRIPTION_MODULE,
      },
    );

    await page.waitForTimeout(4000);

    const ui = await page.evaluate(() => ({
      mdHub: Boolean(window.MdHub?.command?.send),
      showAvailable: Boolean(window.MdHub?.module?.show),
      iframeCount: document.querySelectorAll('iframe').length,
    }));

    const statusText = await page
      .locator('body')
      .innerText()
      .then((t) =>
        t
          .split('\n')
          .filter((l) => /Prescrição|Revise|Memed|Losartana|widget|aberta/i.test(l))
          .slice(0, 10)
          .join(' | '),
      );

    const find = (cmd: string) => flowResults.find((r) => r.command === cmd);

    const report = {
      generated_at: new Date().toISOString(),
      atendimentoId: ATENDIMENTO_ID,
      panel_url: PANEL_URL,
      builder_source: 'mdoctor-panel/src/lib/memed/setMemedPatient.ts — buildSetPacientePayload',
      internal_paciente_nome: atendimento.paciente_nome,
      setPaciente_payload: setPacientePayload,
      addItem_payload: addItemPayload,
      status_message: statusText,
      commands: {
        getUsuario: find('getUsuario'),
        setPaciente: find('setPaciente'),
        newPrescription: find('newPrescription'),
        addItem: find('addItem'),
        show: find('show'),
      },
      flow_results: flowResults,
      ui,
    };

    fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');
    await page.screenshot({ path: SCREENSHOT, fullPage: false });

    console.log('VALIDACAO:', JSON.stringify(report.commands, null, 2));

    const setPaciente = find('setPaciente');
    const addItem = find('addItem');

    expect(setPacientePayload.nome).toBeTruthy();
    expect(setPacientePayload.cpf).toBeUndefined();
    expect(setPacientePayload.email).toBeUndefined();
    expect(setPacientePayload.data_nascimento).toBeUndefined();
    expect(String(setPacientePayload.nome)).not.toContain('RENOVAÇÃO');
    expect(setPacientePayload.idExterno).toBe(ATENDIMENTO_ID);

    expect(setPaciente?.outcome).toBe('OK');
    expect((setPaciente?.duration_ms ?? 0) < 15_000).toBeTruthy();
    expect(find('newPrescription')?.outcome).toBe('OK');
    expect(addItem?.outcome).toBe('OK');
    expect(find('show')?.outcome).toBe('OK');
    expect(find('getUsuario')?.outcome).toBe('OK');
    expect(ui.iframeCount).toBeGreaterThan(0);
  });
});
