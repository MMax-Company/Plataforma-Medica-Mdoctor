/**
 * §4.1 Eligibility Engine
 * Module responsible for clinical triage and filtering low-risk patients.
 * Based on §5 Clinical Triage criteria.
 */

const {
  PROTOCOL_VERSION,
  CONDITIONS,
  normalizeCondition,
  extractUsageDays,
  hasContinuousMedication,
  hasPreviousPrescription,
  buildCriteriaSummary
} = require('../services/clinical-intelligence.service');

const CRITERIA_ALLOW = [CONDITIONS.HAS, CONDITIONS.DM2, CONDITIONS.DLP, CONDITIONS.HIPO];

const CRITERIA_BLOCK = new Set([
  'sintomas_novos',
  'diagnostico_recente',
  'sem_comprovacao',
  'crise_clinica',
  'internacao_recente',
  'receita_muito_antiga',
  'sinais_urgencia',
  'contraindicacao_basica'
]);

class EligibilityEngine {
  /**
   * Evaluate patient data against eligibility criteria.
   * @param {Object} patientData - Data coming from WhatsApp/Panel.
   * @returns {Object} Decision { eligible: boolean, reason: string }
   */
  evaluate(patientData) {
    const condition = normalizeCondition(patientData.condition || patientData.doenca_cronica || '');
    const flags = this._normalizeFlags(patientData.flags);
    const usageDays = extractUsageDays(patientData);
    const hasContinuousUse = hasContinuousMedication(patientData);
    const hasPreviousRx = hasPreviousPrescription(patientData);
    const criteriaUsed = [];

    // 1. Validate mandatory clinical history (conservative profile)
    if (!hasPreviousRx || !hasContinuousUse) {
      return this._rejectedDecision({
        reason: 'Falta comprovação de uso contínuo e receita anterior válida',
        reasonCode: 'documentacao_insuficiente',
        condition,
        flags,
        criteriaUsed: buildCriteriaSummary(['Comprovação de uso contínuo', 'Receita anterior válida'], flags),
        renewalStatus: 'insegura'
      });
    }
    criteriaUsed.push('Comprovação de uso contínuo');
    criteriaUsed.push('Receita anterior válida');

    if (usageDays === null || usageDays < 30) {
      return this._rejectedDecision({
        reason: 'Tempo de uso insuficiente para renovação remota segura',
        reasonCode: 'renovacao_insegura',
        condition,
        flags,
        criteriaUsed: buildCriteriaSummary(['Tempo de uso mínimo >= 30 dias'], flags),
        renewalStatus: 'insegura'
      });
    }
    criteriaUsed.push('Tempo de uso mínimo >= 30 dias');

    // 2. Check for Block Criteria (§5)
    if (this._hasBlockCriteria(flags)) {
      return this._rejectedDecision({
        reason: this._getBlockReason(flags),
        reasonCode: this._getRefusalCode(flags),
        condition,
        flags,
        criteriaUsed: buildCriteriaSummary(criteriaUsed, flags),
        renewalStatus: 'insegura'
      });
    }
    criteriaUsed.push('Sem sinais de alerta/contraindicação básica');

    // 3. Check for Allowed Conditions
    if (!CRITERIA_ALLOW.includes(condition)) {
      return this._rejectedDecision({
        reason: 'Condição fora do protocolo de renovação para telemedicina assíncrona',
        reasonCode: 'consulta_presencial',
        condition,
        flags,
        criteriaUsed: buildCriteriaSummary(criteriaUsed, flags),
        renewalStatus: 'insegura'
      });
    }
    criteriaUsed.push('Condição crônica elegível (HAS/DM2/DLP/Hipotireoidismo)');

    // 4. If passed all filters, it's eligible (low risk)
    return {
      eligible: true,
      reason: 'Paciente filtrado como baixo risco e renovação clínica coerente',
      reasonCode: 'eligible',
      riskLevel: 'BAIXO',
      renewalStatus: 'coerente',
      protocolVersion: PROTOCOL_VERSION,
      conditionNormalized: condition,
      criteriaUsed: buildCriteriaSummary(criteriaUsed, flags),
      flags
    };
  }

  _normalizeFlags(flags = []) {
    if (!Array.isArray(flags)) return [];
    return [...new Set(flags.map((flag) => String(flag || '').trim().toLowerCase()).filter(Boolean))];
  }

  _hasBlockCriteria(flags = []) {
    return flags.some((flag) => CRITERIA_BLOCK.has(flag));
  }

  _getBlockReason(flags = []) {
    if (flags.includes('sintomas_novos')) return 'Paciente relatou sintomas novos';
    if (flags.includes('crise_clinica')) return 'Paciente em crise clínica';
    if (flags.includes('internacao_recente')) return 'Internação recente detectada';
    if (flags.includes('diagnostico_recente')) return 'Diagnóstico muito recente';
    if (flags.includes('contraindicacao_basica')) return 'Contraindicação básica detectada para renovação remota';
    if (flags.includes('sinais_urgencia')) return 'Sinais de urgência detectados';
    return 'Critério de bloqueio clínico detectado';
  }

  _getRefusalCode(flags = []) {
    if (flags.includes('sinais_urgencia') || flags.includes('crise_clinica') || flags.includes('sintomas_novos')) return 'sinais_alarme';
    if (flags.includes('contraindicacao_basica')) return 'medicacao_incompativel';
    if (flags.includes('diagnostico_recente') || flags.includes('internacao_recente')) return 'consulta_presencial';
    return 'renovacao_insegura';
  }

  _rejectedDecision({ reason, reasonCode, condition, flags, criteriaUsed, renewalStatus }) {
    return {
      eligible: false,
      reason,
      reasonCode,
      riskLevel: 'BLOQUEADO',
      renewalStatus,
      protocolVersion: PROTOCOL_VERSION,
      conditionNormalized: condition,
      criteriaUsed: criteriaUsed || [],
      flags: flags || []
    };
  }
}

module.exports = new EligibilityEngine();
