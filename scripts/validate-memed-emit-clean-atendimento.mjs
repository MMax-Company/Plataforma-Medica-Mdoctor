#!/usr/bin/env node
/**
 * Validação final emit=1 com atendimento limpo (sem vínculo Memed prévio).
 * Não altera código de produção — script operacional one-shot.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const lib = require('../mdoctor-backend/scripts/homologacao-clinica-fase2-lib.js');

const PANEL = 'https://painel-medico-staging-staging.up.railway.app';
const REPORT = path.join('docs', 'MEMED-HOMOLOGACAO-PREFILL-STAGING.json');
const SHOT = path.join('docs', 'MEMED-HOMOLOGACAO-PREFILL-STAGING-WIDGET.png');

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
    response: last.response,
    error: last.error,
  };
}

async function createCleanAtendimento(token, correlationId) {
  const ts = Date.now();
  const phone = `+55119${String(ts).slice(-8)}`;
  const body = {
    paciente_nome: `MEMED CLEAN ${ts}`,
    paciente_telefone: phone,
    paciente_cpf: '52998224725',
    paciente_email: `memed.clean.${ts}@homolog.local`,
    condicao: 'Hipertensão arterial (HAS)',
    pagamento_status: 'CONFIRMADO',
    status: 'QUEUE',
    medicacao_em_uso: 'Losartana 50mg',
    dados_clinicos: {
      condition: 'hipertensao',
      doenca_cronica: 'hipertensao',
      previous_prescription: true,
      continuous_use_proof: true,
      uso_continuo: true,
      tempo_uso: 'Mais de 6 meses',
      continuous_use_days: 180,
      eligibility_status: 'eligible',
      medicacao_em_uso: 'Losartana 50mg 1x ao dia',
      med1_nome: 'losartana',
      med1_dose: '50mg',
      med1_frequencia: '24/24h',
      posology: '1 comprimido via oral 24/24h uso contínuo',
      queixa_principal: 'Renovação Losartana 50mg HAS estável.',
      historico_clinico: 'HAS em uso contínuo de losartana sem intercorrências.',
      exame_fisico_telemedicina: 'Sem sinais de alarme.',
      alergias: 'Nenhuma conhecida',
      conduta_sugerida: 'Renovar Losartana 50mg conforme protocolo Fase 1.',
      foto_receita_url: 'https://example.com/receita-homolog-clean.jpg',
      previous_prescription_file: 'https://example.com/receita-homolog-clean.jpg',
      flags: [],
    },
  };

  const res = await fetch(`${lib.BACKEND_URL}/api/atendimentos`, {
    method: 'POST',
    headers: lib.authHeaders(token, correlationId),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  const id = data?.atendimento?.id;
  return { ok: res.ok && Boolean(id), atendimentoId: id, body, data, status: res.status };
}

async function main() {
  if (!PASS) throw new Error('MEDICO_PASS required');

  const correlationId = `memed-clean-${Date.now()}`;

  const login = await fetch(`${lib.BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: USER, password: PASS }),
  }).then((r) => r.json());
  if (!login.token) throw new Error(`Login falhou: ${login.error || 'sem token'}`);

  const created = await createCleanAtendimento(login.token, correlationId);
  if (!created.ok) {
    throw new Error(`Falha criar atendimento: ${JSON.stringify(created)}`);
  }

  const atendimentoId = created.atendimentoId;

  const approve = await lib.clinicalApprove(login.token, atendimentoId, correlationId);
  if (!approve.ok) throw new Error(`Approve falhou: ${JSON.stringify(approve.data)}`);

  const detail = await lib.getAtendimento(login.token, atendimentoId, correlationId);
  const at = detail.data?.atendimento || detail.data;
  const clinical = at?.dados_clinicos || {};

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.addInitScript(({ jwt, user }) => {
    localStorage.setItem('mdoctor_auth_token', jwt);
    localStorage.setItem('mdoctor_auth_user', JSON.stringify(user));
  }, { jwt: login.token, user: login.user });

  const url = `${PANEL}/receita?atendimentoId=${atendimentoId}&emit=1`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByText('Prescrição digital', { exact: true }).waitFor({ timeout: 60000 });

  let flowOk = false;
  try {
    await page.waitForFunction(
      () =>
        /Prescrição aberta|Revise e assine/i.test(document.body.innerText) ||
        (window.__memedDiagnosticLog || []).some(
          (e) =>
            e.phase === 'after' &&
            e.module === 'plataforma.prescricao' &&
            e.command === 'setPaciente' &&
            e.ok,
        ),
      undefined,
      { timeout: 120000 },
    );
    flowOk = true;
  } catch {
    /* captura parcial */
  }

  await page.waitForTimeout(4000);

  const diagnosticLog = await page.evaluate(() => window.__memedDiagnosticLog || []);
  const bodyText = await page.locator('body').innerText();
  const ui = await page.evaluate(() => ({
    iframeCount: document.querySelectorAll('iframe').length,
    mdHub: Boolean(window.MdHub?.command?.send),
  }));

  const widgetChecks = {
    losartana: /Losartana\s*50\s*mg/i.test(bodyText),
    posologia: /Tomar 1 comprimido por via oral a cada 24 horas/i.test(bodyText),
    quantidade30: /30\s*(embalagens|unidades|comprimidos)?/i.test(bodyText),
    paciente_vinculado:
      /Prescrição aberta|paciente vinculado|Revise e assine/i.test(bodyText) ||
      Boolean(summarize(diagnosticLog, 'plataforma.prescricao', 'setPaciente').outcome === 'OK'),
  };

  const commands = {
    getUsuario: summarize(diagnosticLog, 'plataforma.usuario', 'getUsuario'),
    setPaciente: summarize(diagnosticLog, 'plataforma.prescricao', 'setPaciente'),
    newPrescription: summarize(diagnosticLog, 'plataforma.prescricao', 'newPrescription'),
    addItem: summarize(diagnosticLog, 'plataforma.prescricao', 'addItem'),
    show: {
      outcome: ui.iframeCount > 0 && flowOk ? 'OK' : ui.iframeCount > 0 ? 'PARCIAL' : 'FALHA',
      iframeCount: ui.iframeCount,
    },
  };

  const homologada =
    commands.setPaciente.outcome === 'OK' &&
    commands.newPrescription.outcome === 'OK' &&
    commands.addItem.outcome === 'OK' &&
    (commands.show.outcome === 'OK' || commands.show.outcome === 'PARCIAL') &&
    widgetChecks.losartana &&
    widgetChecks.posologia &&
    !commands.setPaciente.payload?.cpf;

  const report = {
    generated_at: new Date().toISOString(),
    homologacao_memed_prefill_staging: homologada ? 'HOMOLOGADA' : 'PENDENTE',
    atendimentoId,
    paciente_nome: at.paciente_nome,
    paciente_telefone: at.paciente_telefone,
    status_atendimento: at.status,
    medicacao_em_uso: clinical.medicacao_em_uso || at.medicacao_em_uso,
    elegibilidade: at.elegibilidade || clinical.eligibility_status,
    validated_url: url,
    panel_url: PANEL,
    deployed_commit: '9127d96',
    setPaciente_payload: commands.setPaciente.payload,
    addItem_payload: commands.addItem.payload,
    commands,
    widget_checks: widgetChecks,
    status_message: bodyText
      .split('\n')
      .filter((l) => /Prescri|Revise|Losartana|Tempo|Aplicando|medicamento|timeout/i.test(l))
      .slice(0, 12),
    diagnostic_log: diagnosticLog,
    ui,
  };

  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  await page.screenshot({ path: SHOT, fullPage: false });

  console.log(JSON.stringify({ atendimentoId, homologada, commands, widgetChecks }, null, 2));
  console.log('report:', REPORT);
  console.log('screenshot:', SHOT);

  await browser.close();

  if (!homologada) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
