const express = require('express');
const memed = require('../integrations/memed.service');
const { assertRealMemedReceipt, getMemedRuntimeStatus } = require('../config/memed-runtime');
const { mirrorMemedPdfToStorage } = require('../services/memed-receipt-mirror.service');
const { fetchPrescriptionArtifacts } = require('../services/memed-prescription-api.service');
const { requireAuth } = require('../auth/auth.middleware');
const { createAuditLog } = require('../store/audit.store');
const { STATUS, getAtendimento, updateAtendimentoStatus, createDecisaoLog } = require('../store/atendimentos.store');
const { createReceitaLog } = require('../store/receitas.store');
const { getPrescriptionByAtendimento, savePrescription } = require('../store/prescriptions.store');

const router = express.Router();

const RECEITA_FLOW_STATUSES = new Set([
  STATUS.APPROVED,
  STATUS.RECEITA_EM_EDICAO,
  'approved',
  'receita_em_edicao'
]);

const SINAPSE_HOMOLOG_SCRIPT_URL =
  'https://integrations.memed.com.br/modulos/plataforma.sinapse-prescricao/build/sinapse-prescricao.min.js';
const SINAPSE_PRODUCTION_SCRIPT_URL =
  'https://memed.com.br/modulos/plataforma.sinapse-prescricao/build/sinapse-prescricao.min.js';
const PARTNERS_SCRIPT_URL = 'https://partners.memed.com.br/integration.js';

function isMemedProductionScriptContext() {
  const env = String(process.env.MEMED_ENVIRONMENT || process.env.MEMED_ENV || '').toLowerCase();
  const apiUrl = String(process.env.MEMED_API_URL || '').toLowerCase();
  return env === 'production' || apiUrl.includes('api.memed.com.br');
}

function defaultScriptUrl() {
  if (process.env.MEMED_SCRIPT_URL) return process.env.MEMED_SCRIPT_URL;
  if (process.env.MEMED_WIDGET_SCRIPT === 'partners') return PARTNERS_SCRIPT_URL;
  if (isMemedProductionScriptContext()) return SINAPSE_PRODUCTION_SCRIPT_URL;
  return SINAPSE_HOMOLOG_SCRIPT_URL;
}

function resolveDoctorId(req) {
  return req.user?.sub || process.env.MEDICO_EXTERNAL_ID || process.env.MEMED_PRESCRITOR_EXTERNAL_ID || null;
}

function existingReceipt(atendimento = {}) {
  return atendimento.dados_clinicos?.memed_receita || {};
}

function hasPersistedReceipt(atendimento = {}) {
  const receipt = existingReceipt(atendimento);
  return Boolean(receipt.receitaId || receipt.memed_id || receipt.providerPrescriptionId);
}

function buildPrescriberSnapshot() {
  return {
    external_id: process.env.MEMED_PRESCRITOR_EXTERNAL_ID || process.env.MEDICO_EXTERNAL_ID || null,
    nome: `${process.env.MEMED_PRESCRITOR_NOME || process.env.MEDICO_NOME || ''} ${
      process.env.MEMED_PRESCRITOR_SOBRENOME || process.env.MEDICO_SOBRENOME || ''
    }`.trim(),
    crm: process.env.MEMED_PRESCRITOR_BOARD_NUMBER || process.env.MEDICO_CRM || null,
    uf: process.env.MEMED_PRESCRITOR_BOARD_STATE || process.env.MEDICO_CRM_UF || null
  };
}

router.get('/config', (_req, res) => {
  const runtime = getMemedRuntimeStatus();
  res.json({
    success: true,
    config: {
      enabled: process.env.MEMED_ENABLED === 'true' || memed.hasCredentials() || memed.hasStaticToken(),
      environment: runtime.environment,
      realMode: runtime.real_enabled,
      mockFallbackAllowed: runtime.mock_fallback_allowed,
      scriptUrl: defaultScriptUrl(),
      containerId: 'prescricao-memed',
      primaryColor: '#1557FF',
      dimensions: {
        minWidth: 820,
        minHeight: 700
      },
      emissionMode: runtime.emission_mode,
      callbackUrl: runtime.callback_url
    },
    runtime
  });
});

router.post('/auth', requireAuth, async (req, res) => {
  try {
    const doctor = {
      crm: req.body?.crm || process.env.MEDICO_CRM || process.env.MEMED_PRESCRITOR_BOARD_NUMBER,
      uf: req.body?.uf || process.env.MEDICO_CRM_UF || process.env.MEMED_PRESCRITOR_BOARD_STATE,
      nome: req.body?.nome || `${process.env.MEDICO_NOME || ''} ${process.env.MEDICO_SOBRENOME || ''}`.trim(),
      cpf: req.body?.cpf || process.env.MEDICO_CPF || process.env.MEMED_PRESCRITOR_CPF,
      email: req.body?.email || process.env.MEDICO_EMAIL || process.env.MEMED_PRESCRITOR_EMAIL,
      telefone: req.body?.telefone || process.env.MEDICO_TELEFONE || process.env.MEMED_PRESCRITOR_TELEFONE,
      sexo: req.body?.sexo || process.env.MEDICO_SEXO || process.env.MEMED_PRESCRITOR_SEXO,
      data_nascimento: req.body?.data_nascimento || process.env.MEDICO_DATA_NASC || process.env.MEMED_PRESCRITOR_DATA_NASC,
      external_id:
        req.body?.external_id ||
        process.env.MEMED_PRESCRITOR_EXTERNAL_ID ||
        process.env.MEDICO_EXTERNAL_ID
    };

    const result = await memed.authenticatePrescriber(doctor);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(502).json({
      success: false,
      error: 'Erro ao autenticar prescritor na Memed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/token', requireAuth, async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    if (forceRefresh) memed.invalidateTokenCache();

    const result = await memed.authenticatePrescriber(memed.buildDoctorFromEnv(), { forceRefresh });
    if (!result.token) {
      return res.status(502).json({
        success: false,
        error: 'Token Memed vazio após autenticação do prescritor',
        code: 'MEMED_TOKEN_EMPTY'
      });
    }
    res.json({ success: true, token: result.token, prescriber: result.prescriber });
  } catch (error) {
    res.status(502).json({
      success: false,
      error: 'Erro ao obter token Memed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/iniciar-emissao', requireAuth, async (req, res) => {
  const { atendimentoId } = req.body || {};
  const correlationId = req.correlationId || req.get('X-Correlation-Id') || `memed-start-${Date.now()}`;
  if (!atendimentoId) {
    return res.status(400).json({ success: false, error: 'atendimentoId obrigatório', correlationId });
  }

  const previous = await getAtendimento(atendimentoId);
  if (!previous) {
    return res.status(404).json({ success: false, error: 'Atendimento não encontrado', correlationId });
  }

  const status = String(previous.status || '').toLowerCase();
  if (previous.dados_clinicos?.memed_bloqueado === true) {
    return res.status(409).json({ success: false, error: 'Memed bloqueada para este atendimento', correlationId });
  }

  if (hasPersistedReceipt(previous)) {
    return res.status(409).json({
      success: false,
      error: 'Receita já vinculada — use validação ou visualização.',
      code: 'MEMED_RECEIPT_ALREADY_EXISTS',
      correlationId
    });
  }

  if (!RECEITA_FLOW_STATUSES.has(status)) {
    return res.status(409).json({
      success: false,
      error: 'Emissão Memed só após approve clínico (status approved).',
      code: 'MEMED_EMISSION_NOT_ALLOWED',
      correlationId
    });
  }

  const medicoId = resolveDoctorId(req);
  const atendimento = await updateAtendimentoStatus(atendimentoId, STATUS.RECEITA_EM_EDICAO, {
    motivo: 'Médico iniciou emissão via widget Memed Sinapse',
    medicoId,
    dados_clinicos: {
      ...(previous.dados_clinicos || {}),
      memed_context: {
        ...(previous.dados_clinicos?.memed_context || {}),
        fluxo: 'sinapse_widget',
        emissao_iniciada_em: new Date().toISOString(),
        emissao_iniciada_por: medicoId
      }
    }
  });

  await createAuditLog({
    entity_type: 'atendimento',
    entity_id: atendimentoId,
    action: 'memed_emission_started',
    actor: medicoId || 'backend',
    payload: { correlationId, status: STATUS.RECEITA_EM_EDICAO }
  });

  return res.json({ success: true, correlationId, atendimento, status: STATUS.RECEITA_EM_EDICAO });
});

router.post('/receita', requireAuth, async (req, res) => {
  const correlationId = req.correlationId || req.get('X-Correlation-Id') || `memed-receipt-${Date.now()}`;
  const {
    atendimentoId,
    receitaUrl,
    receitaId,
    pdfUrl,
    digitalLink,
    digital_link,
    unlockCode,
    unlock_code,
    protocolo,
    protocol,
    storagePath,
    payload
  } = req.body || {};
  if (!atendimentoId) {
    return res.status(400).json({ success: false, error: 'atendimentoId obrigatório', correlationId });
  }

  const memedId = receitaId || payload?.id || payload?.prescription?.id || null;
  let resolvedPdf = pdfUrl || receitaUrl || payload?.pdf || payload?.pdf_url || null;
  let resolvedDigital = digitalLink || digital_link || payload?.digital_link || payload?.link || null;
  let resolvedUnlock = unlockCode || unlock_code || payload?.unlock_code || payload?.codigo_desbloqueio || null;

  if (memedId && (!resolvedPdf || !resolvedDigital || !resolvedUnlock)) {
    try {
      const artifacts = await fetchPrescriptionArtifacts(memedId);
      if (!resolvedPdf && artifacts.pdfUrl) resolvedPdf = artifacts.pdfUrl;
      if (!resolvedDigital && artifacts.digitalLink) resolvedDigital = artifacts.digitalLink;
      if (!resolvedUnlock && artifacts.unlockCode) resolvedUnlock = artifacts.unlockCode;
    } catch (enrichError) {
      console.warn('[memed] enrich prescription artifacts:', enrichError.message);
    }
  }
  if (!memedId && !resolvedPdf && !resolvedDigital) {
    return res.status(422).json({
      success: false,
      error: 'Informe receitaId (memed_id) ou pdfUrl/link digital da receita emitida.',
      correlationId
    });
  }

  const realCheck = assertRealMemedReceipt({
    receitaId: memedId,
    pdfUrl: resolvedPdf || resolvedDigital,
    receitaUrl: receitaUrl || resolvedDigital
  });
  if (!realCheck.ok) {
    return res.status(422).json({
      success: false,
      error: realCheck.message,
      code: realCheck.code,
      correlationId
    });
  }

  const previous = await getAtendimento(atendimentoId);
  if (!previous) return res.status(404).json({ success: false, error: 'Atendimento não encontrado', correlationId });

  if (previous.dados_clinicos?.memed_bloqueado === true) {
    return res.status(409).json({ success: false, error: 'Memed bloqueada para este atendimento', correlationId });
  }

  const priorReceipt = existingReceipt(previous);
  if (priorReceipt.receitaId && memedId && String(priorReceipt.receitaId) !== String(memedId)) {
    return res.status(409).json({
      success: false,
      error: 'Receita Memed já vinculada com ID diferente. Emissão duplicada bloqueada.',
      code: 'MEMED_RECEIPT_ALREADY_EXISTS',
      correlationId
    });
  }

  if (priorReceipt.receitaId && priorReceipt.validated_at) {
    return res.status(409).json({
      success: false,
      error: 'Receita já validada — alteração não permitida.',
      code: 'MEMED_RECEIPT_ALREADY_VALIDATED',
      correlationId
    });
  }

  const status = String(previous.status || '').toLowerCase();
  const allowedPersistStatuses = new Set([
    STATUS.APPROVED,
    STATUS.RECEITA_EM_EDICAO,
    STATUS.RECEITA_EMITIDA,
    STATUS.MEMED_PROCESSING,
    STATUS.AWAITING_VALIDATION,
    'approved',
    'receita_em_edicao',
    'receita_emitida',
    'memed_processing'
  ]);
  if (!allowedPersistStatuses.has(status)) {
    return res.status(409).json({
      success: false,
      error: 'Persistência de receita só após approve clínico e emissão via widget.',
      code: 'MEMED_RECEIPT_NOT_ALLOWED',
      correlationId
    });
  }

  // Idempotência: mesma prescrição recebida novamente → 200 sem re-inserir
  const earlyPrescription = await getPrescriptionByAtendimento(atendimentoId);
  if (earlyPrescription?.provider_prescription_id && memedId &&
      String(earlyPrescription.provider_prescription_id) === String(memedId)) {
    return res.status(200).json({ success: true, alreadyExists: true, id: earlyPrescription.id, correlationId });
  }

  const issuedAt = new Date().toISOString();
  const prescriber = buildPrescriberSnapshot();
  const medicoId = resolveDoctorId(req);

  let mirrorResult = null;
  try {
    mirrorResult = await mirrorMemedPdfToStorage({
      atendimentoId,
      memedId,
      sourceUrl: resolvedPdf || resolvedDigital
    });
  } catch (mirrorError) {
    return res.status(502).json({
      success: false,
      error: 'Falha ao espelhar PDF Memed no storage',
      details: process.env.NODE_ENV === 'development' ? mirrorError.message : undefined,
      correlationId
    });
  }

  const receita = {
    atendimentoId,
    memed_id: memedId,
    receitaUrl: receitaUrl || resolvedDigital || mirrorResult?.signedUrl || resolvedPdf || null,
    pdfUrl: mirrorResult?.signedUrl || resolvedPdf || null,
    digital_link: resolvedDigital || null,
    unlock_code: resolvedUnlock || null,
    storagePath: mirrorResult?.storagePath || storagePath || null,
    receitaId: memedId,
    protocolo: protocolo || protocol || null,
    payload_summary: {
      has_widget_payload: Boolean(payload),
      medication_hint:
        previous.medicacao_em_uso ||
        previous.dados_clinicos?.medicacao_em_uso ||
        previous.dados_clinicos?.medicamento ||
        null
    },
    payload: payload || {},
    issued_at: issuedAt,
    gerada_em: issuedAt,
    origem: 'Memed',
    prescriber,
    confirmed_by_doctor: true
  };

  const receitaLog = await createReceitaLog({
    atendimentoId,
    receitaId: receita.receitaId,
    protocolo: receita.protocolo,
    receitaUrl: receita.receitaUrl,
    pdfUrl: receita.pdfUrl,
    storagePath: receita.storagePath,
    status: STATUS.RECEITA_EMITIDA,
    payload: receita.payload,
    medicoId
  });

  const existingPrescription = await getPrescriptionByAtendimento(atendimentoId);
  let prescriptionRow = existingPrescription;
  if (!existingPrescription?.provider_prescription_id) {
    prescriptionRow = await savePrescription({
      atendimento_id: atendimentoId,
      patient_id: previous.patient_id || null,
      status: 'issued',
      provider: 'memed',
      provider_prescription_id: memedId,
      pdf_url: receita.pdfUrl,
      medications: [
        previous.medicacao_em_uso ||
          previous.dados_clinicos?.medicacao_em_uso ||
          previous.dados_clinicos?.medicamento ||
          'Medicamento conforme avaliação médica'
      ],
      payload: {
        ...receita.payload_summary,
        memed_id: memedId,
        digital_link: resolvedDigital,
        unlock_code: resolvedUnlock,
        issued_at: issuedAt,
        prescriber,
        correlationId
      }
    });
  }

  const atendimento = await updateAtendimentoStatus(atendimentoId, STATUS.RECEITA_EMITIDA, {
    motivo: 'Receita emitida na Memed — aguardando confirmação/validação médica',
    medicoId,
    dados_clinicos: {
      ...(previous.dados_clinicos || {}),
      memed_receita: {
        ...receita,
        logId: receitaLog.id,
        prescription_row_id: prescriptionRow?.id || null
      },
      memed_context: {
        ...(previous.dados_clinicos?.memed_context || {}),
        fluxo: 'sinapse_widget',
        pendente_emissao: false,
        emitida_em: issuedAt
      }
    }
  });

  const decisao = await createDecisaoLog({
    atendimento_id: atendimentoId,
    status_anterior: previous.status,
    status_novo: STATUS.RECEITA_EMITIDA,
    motivo: 'Receita Memed vinculada após confirmação explícita do médico',
    medico_id: medicoId,
    snapshot: {
      memed_id: memedId,
      pdfUrl: receita.pdfUrl,
      issued_at: issuedAt,
      receitaLogId: receitaLog.id,
      correlationId
    }
  });

  await createAuditLog({
    entity_type: 'atendimento',
    entity_id: atendimentoId,
    action: 'memed_receipt_persisted',
    actor: medicoId || 'backend',
    payload: {
      correlationId,
      memed_id: memedId,
      has_pdf: Boolean(receita.pdfUrl),
      prescription_row_id: prescriptionRow?.id || null
    }
  });

  return res.json({
    success: true,
    correlationId,
    atendimento,
    decisao,
    receita,
    receitaLog,
    prescription: prescriptionRow
  });
});

router.post('/receita/cancelada', requireAuth, async (req, res) => {
  const correlationId = req.correlationId || req.get('X-Correlation-Id') || `memed-cancel-${Date.now()}`;
  const { atendimentoId, payload } = req.body || {};
  if (!atendimentoId) {
    return res.status(400).json({ success: false, error: 'atendimentoId obrigatório', correlationId });
  }

  const previous = await getAtendimento(atendimentoId);
  if (!previous) {
    return res.status(404).json({ success: false, error: 'Atendimento não encontrado', correlationId });
  }

  const medicoId = resolveDoctorId(req);
  const atendimento = await updateAtendimentoStatus(atendimentoId, STATUS.RECEITA_EM_EDICAO, {
    motivo: 'Prescrição excluída no widget Memed — aguardando nova emissão',
    medicoId,
    dados_clinicos: {
      ...(previous.dados_clinicos || {}),
      memed_receita: null,
      memed_context: {
        ...(previous.dados_clinicos?.memed_context || {}),
        ultima_exclusao_em: new Date().toISOString(),
        ultima_exclusao_por: medicoId,
        pendente_emissao: true
      }
    }
  });

  await createAuditLog({
    entity_type: 'atendimento',
    entity_id: atendimentoId,
    action: 'memed_prescription_deleted',
    actor: medicoId || 'backend',
    payload: { correlationId, widget_payload: Boolean(payload) }
  });

  return res.json({ success: true, correlationId, atendimento });
});

router.post('/verify', requireAuth, (req, res) => {
  const result = memed.validateToken(req.body?.token);
  res.status(result.valid ? 200 : 400).json(result);
});

module.exports = router;
