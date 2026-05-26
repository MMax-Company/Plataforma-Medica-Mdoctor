/**
 * §4.1 Eligibility Engine
 * Module responsible for clinical triage and filtering low-risk patients.
 * Based on §5 Clinical Triage criteria.
 */

const CRITERIA_ALLOW = [
  'hipertensao',
  'diabetes_tipo_2',
  'dislipidemia',
  'hipotireoidismo'
];

const CRITERIA_BLOCK = [
  'sintomas_novos',
  'diagnostico_recente',
  'sem_comprovacao',
  'crise_clinica',
  'internacao_recente',
  'receita_muito_antiga',
  'sinais_urgencia'
];

class EligibilityEngine {
  /**
   * Evaluate patient data against eligibility criteria.
   * @param {Object} patientData - Data coming from WhatsApp/Panel.
   * @returns {Object} Decision { eligible: boolean, reason: string }
   */
  evaluate(patientData) {
    // 1. Validate mandatory fields
    if (!this._hasValidHistory(patientData)) {
      return { eligible: false, reason: 'Falta comprovação de uso contínuo' };
    }

    // 2. Check for Block Criteria (§5)
    if (this._hasBlockCriteria(patientData)) {
      return { eligible: false, reason: this._getBlockReason(patientData) };
    }

    // 3. Check for Allowed Conditions
    const condition = patientData.condition?.toLowerCase();
    if (!CRITERIA_ALLOW.some(c => condition.includes(c))) {
      return { eligible: false, reason: 'Condição fora do protocolo de renovação' };
    }

    // 4. If passed all filters, it's eligible (low risk)
    return { eligible: true, reason: 'Paciente filtrado como baixo risco (Estável)' };
  }

  _hasValidHistory(data) {
    // Requires previous prescription or proof of continuous use
    return !!data.previous_prescription || !!data.continuous_use_proof;
  }

  _hasBlockCriteria(data) {
    // Check for any flags in the patient data that match block list
    const flags = data.flags || [];
    return flags.some(flag => CRITERIA_BLOCK.includes(flag));
  }

  _getBlockReason(data) {
    const flags = data.flags || [];
    if (flags.includes('sintomas_novos')) return 'Paciente relatou sintomas novos';
    if (flags.includes('crise_clinica')) return 'Paciente em crise clínica';
    if (flags.includes('internacao_recente')) return 'Internação recente detectada';
    if (flags.includes('diagnostico_recente')) return 'Diagnóstico muito recente';
    return 'Critério de bloqueio detectado';
  }
}

module.exports = new EligibilityEngine();
