/**
 * §4.1 Eligibility Engine
 * Module responsible for clinical triage and filtering low-risk patients.
 * Based on §5 Clinical Triage criteria.
 */

const {
  PROTOCOL_VERSION,
  CONDITIONS,
  normalizeCondition,
  normalizeConditions,
  extractUsageDays,
  hasContinuousMedication,
  hasPreviousPrescription,
  hasPrescriptionPhoto,
  hasControlledMedication,
  buildCriteriaSummary
} = require('../services/clinical-intelligence.service');
const { isExternalUploadMode } = require('../services/clinical-payload-normalizer.service');

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
    // Resolve todas as condições selecionadas (suporte a múltipla seleção no Typebot).
    // chronic_conditions (array) tem precedência quando disponível; fallback para
    // condition/chronic_condition (pode ser "hipertensao,dislipidemia" join) ou
    // doenca_cronica (raw label).
    const rawConditionInput =
      patientData.condition ||
      patientData.chronic_condition ||
      patientData.doenca_cronica || '';
    const conditions = Array.isArray(patientData.chronic_conditions) && patientData.chronic_conditions.length
      ? patientData.chronic_conditions
      : normalizeConditions(rawConditionInput);
    // condition (singular) mantido para campos legados em _rejectedDecision/logs
    const condition = conditions[0] || 'renovacao_receita';
    const flags = this._normalizeFlags(patientData.flags);
    const usageDays = extractUsageDays(patientData);
    const hasContinuousUse = hasContinuousMedication(patientData);
    const hasPreviousRx = hasPreviousPrescription(patientData);
    const hasRxPhoto = hasPrescriptionPhoto(patientData);
    const medications = Array.isArray(patientData.medications) ? patientData.medications : [];
    const controlledMedication = hasControlledMedication(medications, patientData.medication || patientData.medicacao_em_uso);
    const criteriaUsed = [];

    if (patientData.eligibility_status === 'ineligible' || patientData._forceIneligible) {
      return this._rejectedDecision({
        reason: patientData._ineligibilityReason || patientData.ineligibility_reason || 'Paciente inelegível na triagem Typebot',
        reasonCode: 'consulta_presencial',
        condition,
        flags,
        criteriaUsed: buildCriteriaSummary(['Triagem Typebot: inelegível'], flags),
        renewalStatus: 'insegura'
      });
    }

    if (patientData.has_warning_signs === true) {
      return this._rejectedDecision({
        reason: 'Sinais de alerta relatados — atendimento presencial recomendado',
        reasonCode: 'sinais_alarme',
        condition,
        flags: [...flags, 'sinais_urgencia'],
        criteriaUsed: buildCriteriaSummary(['Sem sinais de alerta'], [...flags, 'sinais_urgencia']),
        renewalStatus: 'insegura'
      });
    }

    if (controlledMedication) {
      return this._rejectedDecision({
        reason: 'Medicamento controlado ou fora do protocolo de renovação remota',
        reasonCode: 'medicacao_incompativel',
        condition,
        flags: [...flags, 'contraindicacao_basica'],
        criteriaUsed: buildCriteriaSummary(criteriaUsed, [...flags, 'contraindicacao_basica']),
        renewalStatus: 'insegura'
      });
    }

    const awaitingExternalUpload =
      patientData.prescription_upload_pending === true ||
      patientData.validation?.awaiting_prescription_upload === true ||
      flags.includes('aguardando_upload_receita');
    const externalUpload = isExternalUploadMode();
    const photoPending = !hasRxPhoto && (awaitingExternalUpload || (externalUpload && hasPreviousRx));

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

    if (!hasRxPhoto && !photoPending) {
      return this._rejectedDecision({
        reason: 'Foto legível da receita anterior é obrigatória para renovação',
        reasonCode: 'documentacao_insuficiente',
        condition,
        flags,
        criteriaUsed: buildCriteriaSummary(['Comprovação de uso contínuo', 'Receita anterior válida'], flags),
        renewalStatus: 'insegura'
      });
    }

    criteriaUsed.push('Comprovação de uso contínuo');
    criteriaUsed.push('Receita anterior válida');
    if (photoPending) criteriaUsed.push('Upload externo da receita pendente');

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

    const receitaVencidaDias = this._extractReceitaVencidaDias(patientData);
    if (receitaVencidaDias !== null && receitaVencidaDias > 180) {
      const blockFlags = [...new Set([...flags, 'receita_muito_antiga'])];
      return this._rejectedDecision({
        reason: 'Receita anterior fora da janela segura (vencida há mais de 180 dias)',
        reasonCode: 'renovacao_insegura',
        condition,
        flags: blockFlags,
        criteriaUsed: buildCriteriaSummary(criteriaUsed, blockFlags),
        renewalStatus: 'insegura'
      });
    }
    if (receitaVencidaDias !== null) criteriaUsed.push('Receita anterior dentro da janela <= 180 dias');

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

    // 3. Todas as condições devem estar na lista permitida.
    //    Se o array estiver vazio ou qualquer condição não constar em CRITERIA_ALLOW,
    //    a renovação é recusada — sem ignorar condições silenciosamente.
    const blockedConditions = conditions.filter((c) => !CRITERIA_ALLOW.includes(c));
    if (!conditions.length || blockedConditions.length > 0) {
      return this._rejectedDecision({
        reason: blockedConditions.length
          ? `Condição fora do protocolo de renovação: ${blockedConditions.join(', ')}`
          : 'Condição crônica não identificada no protocolo',
        reasonCode: 'consulta_presencial',
        condition,
        conditions,
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
      conditionsNormalized: conditions,
      criteriaUsed: buildCriteriaSummary(criteriaUsed, flags),
      flags
    };
  }

  _extractReceitaVencidaDias(patientData = {}) {
    const raw =
      patientData.receita_vencida_dias ?? patientData.receitaVencidaDias ?? patientData.dias_receita_vencida;
    if (raw === null || raw === undefined || raw === '') return null;
    const converted = Number(raw);
    return Number.isFinite(converted) ? converted : null;
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
    if (flags.includes('receita_muito_antiga')) return 'Receita anterior fora da janela segura';
    return 'Critério de bloqueio clínico detectado';
  }

  _getRefusalCode(flags = []) {
    if (flags.includes('sinais_urgencia') || flags.includes('crise_clinica') || flags.includes('sintomas_novos')) return 'sinais_alarme';
    if (flags.includes('contraindicacao_basica')) return 'medicacao_incompativel';
    if (flags.includes('diagnostico_recente') || flags.includes('internacao_recente')) return 'consulta_presencial';
    return 'renovacao_insegura';
  }

  _rejectedDecision({ reason, reasonCode, condition, conditions, flags, criteriaUsed, renewalStatus }) {
    return {
      eligible: false,
      reason,
      reasonCode,
      riskLevel: 'BLOQUEADO',
      renewalStatus,
      protocolVersion: PROTOCOL_VERSION,
      conditionNormalized: condition,
      conditionsNormalized: conditions || (condition ? [condition] : []),
      criteriaUsed: criteriaUsed || [],
      flags: flags || []
    };
  }
}

module.exports = new EligibilityEngine();
