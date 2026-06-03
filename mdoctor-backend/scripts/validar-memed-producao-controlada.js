#!/usr/bin/env node
/**
 * Validação ISOLADA Memed produção — não usa approve clínico, WhatsApp ou deliver.
 *
 * Pré-requisitos (env obrigatórios):
 *   MEMED_ENABLED=true
 *   MEMED_ALLOW_MOCK_FALLBACK=false
 *   MEMED_ENV=production  (ou MEMED_ENVIRONMENT=production)
 *
 * Chamada real à API Memed (opcional, explícita):
 *   MEMED_VALIDATION_CONFIRM_API=1
 *
 * Persistência opcional (somente tabela prescriptions, sem mudar status):
 *   MEMED_VALIDATION_PERSIST=1
 *   ATENDIMENTO_ID=<uuid-staging-teste>
 *
 * Carregar vars do Railway staging:
 *   LOAD_RAILWAY_VARS=1 node scripts/validar-memed-producao-controlada.js
 *
 * Saída: docs/MEMED-PRODUCAO-CONTROLADA-RELATORIO.json
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPORT_PATH =
  process.env.REPORT_PATH ||
  path.join(__dirname, '../../docs/MEMED-PRODUCAO-CONTROLADA-RELATORIO.json');

const RAILWAY_PROJECT = process.env.RAILWAY_PROJECT_ID || 'bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b';
const RAILWAY_ENV = process.env.RAILWAY_ENVIRONMENT_ID || 'd297af6e-c5e2-406a-9798-69a02f0e7394';
const RAILWAY_SERVICE = process.env.RAILWAY_SERVICE_ID || '53960eb4-a1be-4d7c-b665-462049e52085';

const BACKEND_URL = String(
  process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app'
).replace(/\/$/, '');

/** Paciente 100% fictício — nunca usar dado real de paciente. */
const TEST_PATIENT = {
  id: 'memed-validation-synthetic',
  paciente_nome: 'Paciente Validação Memed Ficticio',
  paciente_cpf: '00000000191',
  paciente_telefone: '5511900000000',
  paciente_email: 'memed.validacao.ficticio@example.invalid',
  medicacao_em_uso: process.env.MEMED_TEST_MEDICATION || 'losartana 50mg',
  dados_clinicos: {
    medicacao_em_uso: process.env.MEMED_TEST_MEDICATION || 'losartana 50mg',
    posologia: process.env.MEMED_TEST_POSOLOGY || '1 comprimido via oral 1x ao dia',
    conduta_medica: 'Validação controlada Memed produção — sem entrega ao paciente.',
    validation_run: true,
    memed_producao_controlada: true
  }
};

function maskSecret(value) {
  const s = String(value || '');
  if (!s) return { present: false, length: 0 };
  return { present: true, length: s.length, preview: `${s.slice(0, 3)}…${s.slice(-2)}` };
}

function loadRailwayVars() {
  if (process.env.LOAD_RAILWAY_VARS !== '1') return;
  try {
    const out = execSync(
      `railway variable list -p ${RAILWAY_PROJECT} -e ${RAILWAY_ENV} -s ${RAILWAY_SERVICE} --json`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    for (const [key, value] of Object.entries(JSON.parse(out))) {
      if (value != null && value !== '') process.env[key] = String(value);
    }
  } catch (error) {
    console.error('LOAD_RAILWAY_VARS failed:', error.message);
  }
}

function memedEnvName() {
  return String(process.env.MEMED_ENV || process.env.MEMED_ENVIRONMENT || '').trim().toLowerCase();
}

function validateRuntimeGates() {
  const enabled = process.env.MEMED_ENABLED === 'true';
  const strict = process.env.MEMED_ALLOW_MOCK_FALLBACK === 'false';
  const production = memedEnvName() === 'production';
  const errors = [];
  if (!enabled) errors.push('MEMED_ENABLED deve ser true');
  if (!strict) errors.push('MEMED_ALLOW_MOCK_FALLBACK deve ser false');
  if (!production) errors.push('MEMED_ENV (ou MEMED_ENVIRONMENT) deve ser production');
  return {
    ok: errors.length === 0,
    errors,
    values: {
      MEMED_ENABLED: process.env.MEMED_ENABLED,
      MEMED_ALLOW_MOCK_FALLBACK: process.env.MEMED_ALLOW_MOCK_FALLBACK,
      MEMED_ENV: process.env.MEMED_ENV || null,
      MEMED_ENVIRONMENT: process.env.MEMED_ENVIRONMENT || null
    }
  };
}

function validateRequiredEnv() {
  const checks = {
    MEMED_API_URL: {
      required: true,
      value: process.env.MEMED_API_URL || 'https://integrations.api.memed.com.br/v1',
      display: process.env.MEMED_API_URL || '(default integrations URL)'
    },
    MEMED_API_KEY: { required: true, ...maskSecret(process.env.MEMED_API_KEY) },
    MEMED_SECRET_KEY: { required: true, ...maskSecret(process.env.MEMED_SECRET_KEY) },
    MEMED_TIMEOUT_MS: {
      required: false,
      value: process.env.MEMED_TIMEOUT_MS || '8000',
      display: String(process.env.MEMED_TIMEOUT_MS || 8000)
    },
    MEMED_RETRY_ATTEMPTS: {
      required: false,
      value: process.env.MEMED_RETRY_ATTEMPTS || '2',
      display: String(process.env.MEMED_RETRY_ATTEMPTS || 2)
    },
    MEMED_PRESCRITOR_EXTERNAL_ID: {
      required: false,
      value: process.env.MEMED_PRESCRITOR_EXTERNAL_ID || process.env.MEDICO_USER || null,
      display: process.env.MEMED_PRESCRITOR_EXTERNAL_ID || process.env.MEDICO_USER || '(ausente)'
    },
    MEMED_PRESCRITOR_NOME: {
      required: false,
      value: process.env.MEMED_PRESCRITOR_NOME || process.env.MEDICO_NOME || null,
      display: process.env.MEMED_PRESCRITOR_NOME || process.env.MEDICO_NOME || '(ausente)'
    },
    MEMED_PRESCRITOR_SOBRENOME: {
      required: false,
      value: process.env.MEMED_PRESCRITOR_SOBRENOME || null,
      display: process.env.MEMED_PRESCRITOR_SOBRENOME || '(ausente)'
    },
    MEMED_PRESCRITOR_CPF: {
      required: false,
      ...maskSecret(process.env.MEMED_PRESCRITOR_CPF || process.env.MEDICO_CPF)
    },
    MEMED_PRESCRITOR_BOARD_NUMBER: {
      required: false,
      value: process.env.MEMED_PRESCRITOR_BOARD_NUMBER || null,
      display: process.env.MEMED_PRESCRITOR_BOARD_NUMBER || '(ausente)'
    },
    MEMED_PRESCRITOR_BOARD_STATE: {
      required: false,
      value: process.env.MEMED_PRESCRITOR_BOARD_STATE || null,
      display: process.env.MEMED_PRESCRITOR_BOARD_STATE || '(ausente)'
    }
  };

  const missing = [];
  if (!checks.MEMED_API_KEY.present) missing.push('MEMED_API_KEY');
  if (!checks.MEMED_SECRET_KEY.present) missing.push('MEMED_SECRET_KEY');

  const medico = {
    external_id: checks.MEMED_PRESCRITOR_EXTERNAL_ID.display,
    nome: checks.MEMED_PRESCRITOR_NOME.display,
    sobrenome: checks.MEMED_PRESCRITOR_SOBRENOME.display,
    cpf_configured: checks.MEMED_PRESCRITOR_CPF.present,
    crm: checks.MEMED_PRESCRITOR_BOARD_NUMBER.display,
    crm_uf: checks.MEMED_PRESCRITOR_BOARD_STATE.display,
    medico_user: process.env.MEDICO_USER || null,
    medico_nome: process.env.MEDICO_NOME || null
  };

  return { ok: missing.length === 0, missing, checks, medico };
}

function buildMemedPayload(atendimento) {
  const env = memedEnvName() || 'production';
  return {
    patient: {
      name: atendimento.paciente_nome,
      document: atendimento.paciente_cpf,
      phone: atendimento.paciente_telefone,
      email: atendimento.paciente_email
    },
    prescription: {
      medications: [
        {
          name: atendimento.medicacao_em_uso,
          posology: atendimento.dados_clinicos?.posologia || 'Conforme protocolo de validação'
        }
      ],
      notes: atendimento.dados_clinicos?.conduta_medica || 'Validação Memed produção controlada'
    },
    environment: env,
    metadata: {
      purpose: 'memed_producao_controlada_validation',
      no_patient_delivery: true,
      synthetic_patient: true
    }
  };
}

async function fetchAtendimentoReadOnly(atendimentoId, token) {
  if (!atendimentoId || !token) return null;
  const res = await fetch(`${BACKEND_URL}/api/atendimentos/${atendimentoId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: data.error };
  return { ok: true, atendimento: data.atendimento || data, read_only: true };
}

async function loginForReadOnly() {
  const user = process.env.MEDICO_USER;
  const pass = process.env.MEDICO_PASS;
  if (!user || !pass) return { ok: false, error: 'MEDICO_USER/MEDICO_PASS ausentes para leitura opcional' };
  const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, password: pass })
  });
  const data = await res.json();
  return { ok: Boolean(data.token), token: data.token };
}

function mergeAtendimentoFromRow(row) {
  if (!row) return { ...TEST_PATIENT };
  return {
    ...TEST_PATIENT,
    id: row.id,
    paciente_nome: 'Paciente Validação Memed Ficticio',
    paciente_cpf: TEST_PATIENT.paciente_cpf,
    paciente_telefone: TEST_PATIENT.paciente_telefone,
    paciente_email: TEST_PATIENT.paciente_email,
    medicacao_em_uso: TEST_PATIENT.medicacao_em_uso,
    dados_clinicos: {
      ...TEST_PATIENT.dados_clinicos,
      source_atendimento_id: row.id,
      original_status_untouched: row.status
    }
  };
}

async function optionalPersistPrescription(atendimentoId, memedResult) {
  if (process.env.MEMED_VALIDATION_PERSIST !== '1') {
    return { attempted: false, persisted: false, reason: 'MEMED_VALIDATION_PERSIST not set' };
  }
  if (!atendimentoId) {
    return { attempted: false, persisted: false, reason: 'ATENDIMENTO_ID required for persist' };
  }
  const { savePrescription } = require('../src/store/prescriptions.store');
  const saved = await savePrescription({
    atendimento_id: atendimentoId,
    status: 'validation',
    provider: memedResult.source || 'memed',
    provider_prescription_id: memedResult.prescriptionId,
    pdf_url: memedResult.pdfUrl,
    medications: [TEST_PATIENT.medicacao_em_uso],
    payload: {
      ...(memedResult.data || {}),
      validation_tag: 'memed_producao_controlada',
      no_clinical_status_change: true
    }
  });
  return {
    attempted: true,
    persisted: Boolean(saved?.id),
    prescription_row_id: saved?.id || null,
    note: 'Não altera status do atendimento — apenas registro em prescriptions'
  };
}

async function main() {
  loadRailwayVars();

  const report = {
    generated_at: new Date().toISOString(),
    script: 'validar-memed-producao-controlada.js',
    purpose: 'Validação isolada Memed produção — sem approve clínico, WhatsApp ou deliver',
    environment_used: memedEnvName() || null,
    backend_url: BACKEND_URL,
    success: false,
    gates: null,
    env_validation: null,
    medico_identificado: null,
    payload_validado: null,
    api_call: {
      executed: false,
      confirmed_by_env: process.env.MEMED_VALIDATION_CONFIRM_API === '1'
    },
    memed_result: null,
    memed_error: null,
    has_pdf_or_link: false,
    pdf_url: null,
    prescription_id: null,
    persistence: null,
    safety: {
      whatsapp_triggered: false,
      deliver_triggered: false,
      clinical_approve_triggered: false,
      patient_is_synthetic: true,
      atendimento_status_changed: false
    },
    errors: []
  };

  const gates = validateRuntimeGates();
  report.gates = gates;
  if (!gates.ok) {
    report.errors.push(...gates.errors);
    writeReport(report);
    printSummary(report);
    process.exit(1);
  }

  const envValidation = validateRequiredEnv();
  report.env_validation = {
    ok: envValidation.ok,
    missing: envValidation.missing,
    api_url: envValidation.checks.MEMED_API_URL.display,
    api_key: { present: envValidation.checks.MEMED_API_KEY.present, length: envValidation.checks.MEMED_API_KEY.length },
    secret_key: {
      present: envValidation.checks.MEMED_SECRET_KEY.present,
      length: envValidation.checks.MEMED_SECRET_KEY.length
    },
    timeout_ms: envValidation.checks.MEMED_TIMEOUT_MS.display,
    retry_attempts: envValidation.checks.MEMED_RETRY_ATTEMPTS.display
  };
  report.medico_identificado = envValidation.medico;
  report.environment_used = memedEnvName();

  if (!envValidation.ok) {
    report.errors.push(`Variáveis ausentes: ${envValidation.missing.join(', ')}`);
    writeReport(report);
    printSummary(report);
    process.exit(1);
  }

  let atendimento = { ...TEST_PATIENT };
  const atendimentoId = String(process.env.ATENDIMENTO_ID || '').trim();

  if (atendimentoId) {
    const login = await loginForReadOnly();
    if (login.ok) {
      const row = await fetchAtendimentoReadOnly(atendimentoId, login.token);
      if (row?.ok) {
        atendimento = mergeAtendimentoFromRow(row.atendimento);
        report.atendimento_reference = {
          id: atendimentoId,
          read_only: true,
          original_status: row.atendimento?.status
        };
      } else {
        report.errors.push('ATENDIMENTO_ID informado mas leitura falhou — usando paciente sintético');
      }
    } else {
      report.errors.push('Leitura ATENDIMENTO_ID ignorada — login indisponível');
    }
  }

  const payload = buildMemedPayload(atendimento);
  report.payload_validado = {
    ok: true,
    patient_name: payload.patient.name,
    medication: payload.prescription.medications[0].name,
    posology: payload.prescription.medications[0].posology,
    environment: payload.environment,
    notes: payload.prescription.notes
  };

  if (process.env.MEMED_VALIDATION_CONFIRM_API !== '1') {
    report.api_call.executed = false;
    report.api_call.skipped_reason =
      'Defina MEMED_VALIDATION_CONFIRM_API=1 para chamada real (dry-run de payload concluído)';
    report.success = true;
    writeReport(report);
    printSummary(report);
    process.exit(0);
  }

  const memedIntegration = require('../src/integrations/memed.service');
  if (!memedIntegration.hasCredentials()) {
    report.errors.push('Memed não configurada (API key/secret ausentes ou inválidos)');
    writeReport(report);
    printSummary(report);
    process.exit(1);
  }

  if (process.env.MEMED_ALLOW_MOCK_FALLBACK !== 'false') {
    report.errors.push('MEMED_ALLOW_MOCK_FALLBACK deve ser false durante chamada real de validação');
    writeReport(report);
    printSummary(report);
    process.exit(1);
  }

  report.api_call.executed = true;

  const doctor = {
    external_id: process.env.MEMED_PRESCRITOR_EXTERNAL_ID || process.env.MEDICO_EXTERNAL_ID,
    nome: `${process.env.MEMED_PRESCRITOR_NOME || ''} ${process.env.MEMED_PRESCRITOR_SOBRENOME || ''}`.trim(),
    cpf: process.env.MEMED_PRESCRITOR_CPF || process.env.MEDICO_CPF,
    crm: process.env.MEMED_PRESCRITOR_BOARD_NUMBER || process.env.MEDICO_CRM,
    uf: process.env.MEMED_PRESCRITOR_BOARD_STATE || process.env.MEDICO_CRM_UF,
    email: process.env.MEMED_PRESCRITOR_EMAIL || process.env.MEDICO_EMAIL,
    telefone: process.env.MEMED_PRESCRITOR_TELEFONE || process.env.MEDICO_TELEFONE,
    data_nascimento: process.env.MEMED_PRESCRITOR_DATA_NASC || process.env.MEDICO_DATA_NASC
  };

  let prescriberAuth = { ok: false, has_token: false, prescriber_id: null, mode: null, error: null };
  try {
    const auth = await memedIntegration.authenticatePrescriber(doctor);
    const tokenCheck = memedIntegration.validateToken(auth.token);
    prescriberAuth = {
      ok: Boolean(auth.token) && tokenCheck.valid,
      has_token: Boolean(auth.token),
      prescriber_id: auth.prescriber?.id || null,
      mode: auth.prescriber?.mode || 'sinapse',
      token_valid_jwt: tokenCheck.valid
    };
  } catch (error) {
    prescriberAuth = {
      ok: false,
      has_token: false,
      error: error.response?.data?.errors?.[0]?.detail || error.message,
      http_status: error.response?.status || null
    };
    report.memed_error = {
      code: prescriberAuth.http_status ? `MEMED_HTTP_${prescriberAuth.http_status}` : 'MEMED_PRESCRIBER_AUTH_FAILED',
      message: prescriberAuth.error
    };
  }

  report.prescriber_auth = prescriberAuth;

  let prescriptionProbe = { attempted: false, success: false, prescriptionId: null, pdfUrl: null, error: null };
  if (prescriberAuth.ok) {
    prescriptionProbe.attempted = true;
    const rx = await memedIntegration.createPrescription({
      patientName: atendimento.paciente_nome,
      patientDocument: atendimento.paciente_cpf,
      patientPhone: atendimento.paciente_telefone,
      patientEmail: atendimento.paciente_email,
      medications: [
        {
          name: atendimento.medicacao_em_uso,
          posology: atendimento.dados_clinicos?.posologia || 'Conforme protocolo de validação'
        }
      ],
      notes: atendimento.dados_clinicos?.conduta_medica,
      doctorName: doctor.nome,
      doctorCrm: doctor.crm,
      doctorUf: doctor.uf
    });
    prescriptionProbe = {
      attempted: true,
      success: rx.success === true,
      prescriptionId: rx.prescriptionId || null,
      pdfUrl: rx.pdfUrl || null,
      error: rx.error || null,
      http_status: rx.httpStatus || null,
      note:
        rx.success === false
          ? 'Em produção Memed a emissão costuma ocorrer via widget Sinapse; REST /prescriptions pode estar bloqueado.'
          : null
    };
  }

  report.prescription_api_probe = prescriptionProbe;
  report.memed_result = {
    success: prescriberAuth.ok,
    source: 'memed',
    prescriptionId: prescriptionProbe.prescriptionId,
    pdfUrl: prescriptionProbe.pdfUrl,
    warning: prescriptionProbe.note || null
  };
  report.prescription_id = prescriptionProbe.prescriptionId;
  report.pdf_url = prescriptionProbe.pdfUrl;
  report.has_pdf_or_link = Boolean(prescriptionProbe.pdfUrl || prescriptionProbe.prescriptionId);

  if (!prescriberAuth.ok) {
    report.errors.push('Autenticação do prescritor na Memed produção falhou');
  }

  const persistResult = prescriptionProbe.success
    ? {
        success: true,
        source: 'memed',
        prescriptionId: prescriptionProbe.prescriptionId,
        pdfUrl: prescriptionProbe.pdfUrl,
        data: { validation_tag: 'memed_producao_controlada' }
      }
    : null;
  report.persistence = await optionalPersistPrescription(atendimentoId || null, persistResult || {});

  report.success = prescriberAuth.ok && prescriberAuth.has_token && report.errors.length === 0;

  writeReport(report);
  printSummary(report);
  process.exit(report.success ? 0 : 1);
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
}

function printSummary(report) {
  const summary = {
    success: report.success,
    environment_used: report.environment_used,
    medico_identificado: report.medico_identificado,
    payload_validado: report.payload_validado,
    api_call_executed: report.api_call.executed,
    prescriber_auth: report.prescriber_auth,
    prescription_api_probe: report.prescription_api_probe,
    memed_error: report.memed_error,
    has_pdf_or_link: report.has_pdf_or_link,
    prescription_id: report.prescription_id,
    pdf_url: report.pdf_url,
    persisted: report.persistence?.persisted ?? false,
    report_path: REPORT_PATH
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  const report = {
    generated_at: new Date().toISOString(),
    success: false,
    fatal_error: error.message
  };
  try {
    writeReport(report);
  } catch {
    // ignore
  }
  console.error(error);
  process.exit(1);
});
