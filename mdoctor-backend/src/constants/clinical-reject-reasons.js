/**
 * Motivos padronizados de reprovação clínica (Fase 2 — homologação operacional).
 * @see docs/HOMOLOGACAO-CLINICA-FASE2.md
 */

const CLINICAL_REJECT_REASONS = {
  RED_FLAG: {
    code: 'RED_FLAG',
    label: 'Sinal de alerta / red flag',
    description: 'Paciente com sinais de alerta que exigem avaliação presencial imediata.'
  },
  DOCUMENTACAO_INSUFICIENTE: {
    code: 'DOCUMENTACAO_INSUFICIENTE',
    label: 'Documentação insuficiente',
    description: 'Prontuário ou anexos insuficientes para decisão segura.'
  },
  RECEITA_AUSENTE: {
    code: 'RECEITA_AUSENTE',
    label: 'Receita anterior ausente',
    description: 'Não há comprovação válida de receita anterior.'
  },
  FORA_DO_PROTOCOLO: {
    code: 'FORA_DO_PROTOCOLO',
    label: 'Fora do protocolo',
    description: 'Caso fora do protocolo de renovação por telemedicina.'
  },
  MEDICACAO_INCOMPATIVEL: {
    code: 'MEDICACAO_INCOMPATIVEL',
    label: 'Medicação incompatível',
    description: 'Medicação solicitada incompatível com histórico ou protocolo.'
  },
  RISCO_CLINICO: {
    code: 'RISCO_CLINICO',
    label: 'Risco clínico elevado',
    description: 'Risco clínico incompatível com atendimento assíncrono.'
  },
  DADOS_INCONSISTENTES: {
    code: 'DADOS_INCONSISTENTES',
    label: 'Dados inconsistentes',
    description: 'Dados do paciente ou triagem inconsistentes.'
  },
  OUTROS: {
    code: 'OUTROS',
    label: 'Outros',
    description: 'Outro motivo — exige texto complementar no campo motivo.'
  }
};

const VALID_CODES = Object.keys(CLINICAL_REJECT_REASONS);

function normalizeReasonCode(input) {
  if (!input) return null;
  const code = String(input).trim().toUpperCase();
  return VALID_CODES.includes(code) ? code : null;
}

function getRejectReasonMeta(code) {
  return CLINICAL_REJECT_REASONS[normalizeReasonCode(code)] || null;
}

function listRejectReasons() {
  return VALID_CODES.map((code) => ({
    code,
    label: CLINICAL_REJECT_REASONS[code].label,
    description: CLINICAL_REJECT_REASONS[code].description,
    requiresDetail: code === 'OUTROS'
  }));
}

function buildRejectMotivoText({ reasonCode, detail }) {
  const meta = getRejectReasonMeta(reasonCode);
  if (!meta) return detail || null;
  if (reasonCode === 'OUTROS') {
    return detail ? `Outros: ${detail}` : meta.label;
  }
  return detail ? `${meta.label} — ${detail}` : meta.label;
}

function validateRejectPayload(body = {}) {
  const reasonCode = normalizeReasonCode(body.reason_code || body.motivo_rejeicao || body.reject_reason);
  if (!reasonCode) {
    return {
      ok: false,
      statusCode: 400,
      error: 'reason_code obrigatório. Valores: ' + VALID_CODES.join(', ')
    };
  }

  const detail = String(body.motivo || body.notes || body.observacao_medica || '').trim();
  if (reasonCode === 'OUTROS' && detail.length < 5) {
    return {
      ok: false,
      statusCode: 400,
      error: 'Para reason_code OUTROS, informe motivo ou observacao_medica com pelo menos 5 caracteres.'
    };
  }

  return { ok: true, reasonCode, detail, meta: getRejectReasonMeta(reasonCode) };
}

module.exports = {
  CLINICAL_REJECT_REASONS,
  VALID_CODES,
  normalizeReasonCode,
  getRejectReasonMeta,
  listRejectReasons,
  buildRejectMotivoText,
  validateRejectPayload
};
