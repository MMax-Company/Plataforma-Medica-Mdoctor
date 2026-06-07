import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { BACKEND_URL, LOGIN_PASS, LOGIN_USER, PANEL_URL } from './helpers/panel-config';

const ATENDIMENTO_ID = process.env.ATENDIMENTO_ID || 'c302bd9e-060a-4ee8-b4cf-0c78392f60c6';
const REPORT_JSON = path.join(__dirname, '../docs/MEMED-SETPACIENTE-CIRURGICO.json');
const REPORT_MD = path.join(__dirname, '../docs/MEMED-SETPACIENTE-CIRURGICO.md');
const PROBE_TIMEOUT_MS = Number(process.env.MEMED_PROBE_TIMEOUT_MS || 12_000);

const ID_EXTERNO = ATENDIMENTO_ID;

async function apiLogin() {
  const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: LOGIN_USER, password: LOGIN_PASS }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error(data.error || `login ${res.status}`);
  return data;
}

async function fetchMemedConfig(token: string) {
  const res = await fetch(`${BACKEND_URL}/api/memed/config`);
  const cfg = await res.json();
  const tok = await fetch(`${BACKEND_URL}/api/memed/token`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const tokBody = await tok.json();
  return { config: cfg.config, memedToken: tokBody.token as string, prescriber: tokBody.prescriber };
}

test.describe('Investigação cirúrgica setPaciente Memed', () => {
  test.beforeAll(() => {
    if (!LOGIN_PASS) test.skip(true, 'MEDICO_PASS obrigatório');
  });

  test('TESTES A–E + variantes de contrato paciente', async ({ page }) => {
    test.setTimeout(900_000);

    const networkHits: Array<{ method: string; url: string; status?: number; ms?: number }> = [];
    const consoleLines: string[] = [];

    page.on('console', (msg) => {
      const t = msg.text();
      if (/memed|mdhub|paciente|patient|setPaciente|prescricao|error/i.test(t)) {
        consoleLines.push(`[${msg.type()}] ${t.slice(0, 500)}`);
      }
    });

    page.on('response', async (res) => {
      const url = res.url();
      if (!/memed\.com\.br|sherlock-api\.memed/i.test(url)) return;
      if (!/paciente|patient|usuario|prescri|graphql|api\//i.test(url)) return;
      networkHits.push({
        method: res.request().method(),
        url: url.split('?')[0],
        status: res.status(),
      });
    });

    const login = await apiLogin();
    const memedMeta = await fetchMemedConfig(login.token);

    await page.addInitScript(({ jwt, user }) => {
      localStorage.setItem('mdoctor_auth_token', jwt);
      localStorage.setItem('mdoctor_auth_user', JSON.stringify(user));
    }, { jwt: login.token, user: login.user });

    // Carrega Memed sem auto-emit — só script + MdHub
    await page.goto(`${PANEL_URL}/receita?atendimentoId=${ATENDIMENTO_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await expect(page.getByText('Prescrição digital', { exact: true })).toBeVisible({ timeout: 60_000 });

    await page.waitForFunction(
      () => Boolean(window.MdHub?.command?.send && window.MdSinapsePrescricao),
      undefined,
      { timeout: 120_000 },
    );
    await page.waitForTimeout(5000);

    const probeResult = await page.evaluate(
      async ({ probeTimeoutMs, idExterno }) => {
        type ProbeResult = {
          id: string;
          label: string;
          module: string;
          command: string;
          payload: unknown;
          outcome: 'OK' | 'TIMEOUT' | 'REJECT';
          duration_ms: number;
          response?: unknown;
          error?: string;
          newPrescription?: { outcome: string; duration_ms: number; error?: string };
        };

        const serialize = (v: unknown) => {
          try {
            return JSON.parse(JSON.stringify(v ?? null));
          } catch {
            return String(v);
          }
        };

        async function probe(
          id: string,
          label: string,
          module: string,
          command: string,
          payload?: unknown,
        ): Promise<ProbeResult> {
          const started = performance.now();
          let outcome: ProbeResult['outcome'] = 'REJECT';
          let response: unknown;
          let error: string | undefined;

          try {
            response = await Promise.race([
              window.MdHub!.command.send(module, command, payload),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('TIMEOUT')), probeTimeoutMs),
              ),
            ]);
            outcome = 'OK';
          } catch (e) {
            error = e instanceof Error ? e.message : String(e);
            outcome = error === 'TIMEOUT' ? 'TIMEOUT' : 'REJECT';
          }

          const base: ProbeResult = {
            id,
            label,
            module,
            command,
            payload: serialize(payload),
            outcome,
            duration_ms: Math.round(performance.now() - started),
            response: outcome === 'OK' ? serialize(response) : undefined,
            error,
          };

          if (outcome === 'OK' && module === 'plataforma.prescricao') {
            try {
              const npStarted = performance.now();
              await Promise.race([
                window.MdHub!.command.send('plataforma.prescricao', 'newPrescription'),
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('TIMEOUT')), probeTimeoutMs),
                ),
              ]);
              base.newPrescription = { outcome: 'OK', duration_ms: Math.round(performance.now() - npStarted) };
            } catch (e) {
              base.newPrescription = {
                outcome: e instanceof Error && e.message === 'TIMEOUT' ? 'TIMEOUT' : 'REJECT',
                duration_ms: probeTimeoutMs,
                error: e instanceof Error ? e.message : String(e),
              };
            }
          }

          return base;
        }

        function discoverModules(): string[] {
          const hub = window.MdHub as unknown as Record<string, unknown>;
          const found = new Set<string>([
            'plataforma.prescricao',
            'plataforma.usuario',
            'plataforma.sdk',
            'platform.patient-management',
            'plataforma.patient-management',
          ]);
          try {
            const mod = hub.module as { list?: unknown } | undefined;
            if (typeof mod?.list === 'function') {
              const listed = (mod.list as () => unknown)();
              if (Array.isArray(listed)) listed.forEach((m) => found.add(String(m)));
            }
          } catch {
            /* ignore */
          }
          for (const key of ['modules', '_modules']) {
            const val = hub[key];
            if (val && typeof val === 'object') Object.keys(val as object).forEach((k) => found.add(k));
          }
          return [...found];
        }

        const getUsuarioProbe = await probe('PRE', 'getUsuario baseline', 'plataforma.usuario', 'getUsuario');

        const tests: ProbeResult[] = [];

        tests.push(
          await probe('BASELINE', 'Payload atual completo', 'plataforma.prescricao', 'setPaciente', {
            nome: 'PACIENTE TESTE 05 - RENOVAÇÃO RECEITA',
            telefone: '11988700005',
            idExterno: idExterno,
            cpf: '23100299900',
            email: 'homolog.teste05@mdoctor.local',
            data_nascimento: '22/01/1964',
          }),
        );

        const minimal = {
          nome: 'PACIENTE TESTE 05',
          telefone: '11988700005',
          idExterno: idExterno,
        };

        tests.push(await probe('TEST_A', 'Payload mínimo', 'plataforma.prescricao', 'setPaciente', minimal));

        tests.push(
          await probe('FIELD_cpf', 'Mínimo + cpf', 'plataforma.prescricao', 'setPaciente', {
            ...minimal,
            cpf: '23100299900',
          }),
        );

        tests.push(
          await probe('FIELD_email', 'Mínimo + email', 'plataforma.prescricao', 'setPaciente', {
            ...minimal,
            email: 'homolog.teste05@mdoctor.local',
          }),
        );

        tests.push(
          await probe('FIELD_data_nascimento', 'Mínimo + data_nascimento', 'plataforma.prescricao', 'setPaciente', {
            ...minimal,
            data_nascimento: '22/01/1964',
          }),
        );

        tests.push(
          await probe('FIELD_nome_longo', 'Nome longo baseline', 'plataforma.prescricao', 'setPaciente', {
            ...minimal,
            nome: 'PACIENTE TESTE 05 - RENOVAÇÃO RECEITA',
          }),
        );

        tests.push(
          await probe('FIELD_triple', 'cpf + email + data_nascimento', 'plataforma.prescricao', 'setPaciente', {
            ...minimal,
            cpf: '23100299900',
            email: 'homolog.teste05@mdoctor.local',
            data_nascimento: '22/01/1964',
          }),
        );

        tests.push(
          await probe('FIELD_all_short_nome', 'Todos extras nome curto', 'plataforma.prescricao', 'setPaciente', {
            nome: 'PACIENTE TESTE 05',
            telefone: '11988700005',
            idExterno: idExterno,
            cpf: '23100299900',
            email: 'homolog.teste05@mdoctor.local',
            data_nascimento: '22/01/1964',
          }),
        );

        tests.push(
          await probe('TEST_B', 'Sem telefone', 'plataforma.prescricao', 'setPaciente', {
            nome: 'PACIENTE TESTE 05',
            idExterno: idExterno,
          }),
        );

        tests.push(
          await probe('TEST_C', 'Campos memed-react vazios', 'plataforma.prescricao', 'setPaciente', {
            nome: 'PACIENTE TESTE 05',
            telefone: '11988700005',
            idExterno: idExterno,
            endereco: '',
            cidade: '',
            altura: '',
          }),
        );

        tests.push(
          await probe('TEST_A_EXT', 'Mínimo com external_id (doc Memed)', 'plataforma.prescricao', 'setPaciente', {
            nome: 'PACIENTE TESTE 05',
            telefone: '11988700005',
            external_id: idExterno,
          }),
        );

        tests.push(
          await probe('TEST_A_SNAKE', 'Mínimo id_externo snake', 'plataforma.prescricao', 'setPaciente', {
            nome: 'PACIENTE TESTE 05',
            telefone: '11988700005',
            id_externo: idExterno,
          }),
        );

        const commandVariants = ['setPatient', 'setPatientData', 'setPaciente', 'setAdditionalData'];
        for (const cmd of commandVariants) {
          tests.push(
            await probe(
              `TEST_D_${cmd}`,
              `Comando alternativo: ${cmd}`,
              'plataforma.prescricao',
              cmd,
              { nome: 'PACIENTE TESTE 05', telefone: '11988700005', idExterno: idExterno },
            ),
          );
        }

        const modules = discoverModules();
        const moduleCandidates = [
          'plataforma.prescricao',
          'plataforma.usuario',
          'platform.patient-management',
          'plataforma.patient-management',
          ...modules.filter((m) => /patient|paciente|usuario|prescri/i.test(m)),
        ];
        const uniqueModules = [...new Set(moduleCandidates)];

        for (const mod of uniqueModules) {
          if (mod === 'plataforma.prescricao') continue;
          tests.push(
            await probe(
              `TEST_E_${mod.replace(/[^a-zA-Z0-9]/g, '_')}`,
              `setPaciente em módulo ${mod}`,
              mod,
              'setPaciente',
              { nome: 'PACIENTE TESTE 05', telefone: '11988700005', idExterno: idExterno },
            ),
          );
        }

        return {
          getUsuario: getUsuarioProbe,
          discovered_modules: uniqueModules,
          tests,
          mdHubKeys: Object.keys(window.MdHub || {}),
        };
      },
      { probeTimeoutMs: PROBE_TIMEOUT_MS, idExterno: ID_EXTERNO },
    );

    const working = probeResult.tests.filter((t) => t.outcome === 'OK');
    const timeouts = probeResult.tests.filter((t) => t.outcome === 'TIMEOUT');
    const rejects = probeResult.tests.filter((t) => t.outcome === 'REJECT');

    const report = {
      generated_at: new Date().toISOString(),
      atendimentoId: ATENDIMENTO_ID,
      panel_url: PANEL_URL,
      backend_url: BACKEND_URL,
      probe_timeout_ms: PROBE_TIMEOUT_MS,
      environment: {
        memed_script: memedMeta.config?.scriptUrl,
        memed_env: memedMeta.config?.environment,
        memed_real_mode: memedMeta.config?.realMode,
        prescriber: memedMeta.prescriber,
      },
      getUsuario_baseline: probeResult.getUsuario,
      discovered_modules: probeResult.discovered_modules,
      mdHub_keys: probeResult.mdHubKeys,
      summary: {
        total_probes: probeResult.tests.length,
        ok: working.length,
        timeout: timeouts.length,
        reject: rejects.length,
        any_setPaciente_ok: working.some((t) => t.command === 'setPaciente'),
        any_newPrescription_after_ok: working.some((t) => t.newPrescription?.outcome === 'OK'),
      },
      tests: probeResult.tests,
      console_memed_related: consoleLines.slice(0, 40),
      network_memed_related: networkHits.slice(0, 40),
      conclusions: {
        working_command: working[0]?.command ?? null,
        working_module: working[0]?.module ?? null,
        working_payload: working[0]?.payload ?? null,
        blocking_field_hypothesis:
          working.length === 0
            ? 'Nenhum payload/comando retornou OK — bloqueio no MdHub setPaciente independente de campos testados'
            : null,
      },
    };

    fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');

    const md = buildMarkdownReport(report);
    fs.writeFileSync(REPORT_MD, md, 'utf8');

    console.log('RESUMO CIRÚRGICO:', JSON.stringify(report.summary, null, 2));
    if (working.length > 0) {
      console.log('FUNCIONOU:', JSON.stringify(working, null, 2));
    }

    // Não falhar o teste — entrega é o relatório
    expect(probeResult.getUsuario.outcome).toBe('OK');
  });
});

type Report = {
  generated_at: string;
  atendimentoId: string;
  environment: Record<string, unknown>;
  getUsuario_baseline: { outcome: string; duration_ms: number };
  summary: Record<string, unknown>;
  tests: Array<{
    id: string;
    label: string;
    module: string;
    command: string;
    payload: unknown;
    outcome: string;
    duration_ms: number;
    error?: string;
    newPrescription?: { outcome: string; duration_ms: number; error?: string };
  }>;
  conclusions: Record<string, unknown>;
};

function buildMarkdownReport(report: Report): string {
  const lines = [
    '# Investigação cirúrgica — Memed setPaciente',
    '',
    `> ${report.generated_at}`,
    '',
    '## Baseline getUsuario',
    '',
    `- **Outcome:** ${report.getUsuario_baseline.outcome}`,
    `- **Tempo:** ${report.getUsuario_baseline.duration_ms} ms`,
    '',
    '## Resumo',
    '',
    `| Métrica | Valor |`,
    `|---------|-------|`,
    ...Object.entries(report.summary).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '## Resultados por teste',
    '',
    '| ID | Módulo | Comando | Outcome | ms | newPrescription |',
    '|----|--------|---------|---------|-----|-----------------|',
  ];

  for (const t of report.tests) {
    lines.push(
      `| ${t.id} | ${t.module} | ${t.command} | **${t.outcome}** | ${t.duration_ms} | ${t.newPrescription?.outcome ?? '—'} |`,
    );
  }

  lines.push('', '## Payloads detalhados', '');
  for (const t of report.tests) {
    lines.push(`### ${t.id} — ${t.label}`, '');
    lines.push('```json');
    lines.push(JSON.stringify({ module: t.module, command: t.command, payload: t.payload, outcome: t.outcome, error: t.error }, null, 2));
    lines.push('```', '');
  }

  if (report.summary.ok === 0) {
    lines.push('## Dossiê suporte Memed', '');
    lines.push('- Prescritor: ver `environment.prescriber` no JSON');
    lines.push('- getUsuario: OK');
    lines.push('- setPaciente e variantes: TIMEOUT ou REJECT em todos os probes');
    lines.push('- Payloads testados: ver seção Resultados');
  }

  return lines.join('\n');
}
