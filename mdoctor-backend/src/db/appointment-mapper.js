/**
 * Mapeia appointments (schema oficial) ↔ shape legado usado pelas rotas (atendimento).
 */

function rowToAtendimento(row = {}) {
  const clinical = row.clinical_data || row.dados_clinicos || {};
  return {
    id: row.id,
    patient_id: row.patient_id || null,
    status: row.status,
    paciente_nome: row.patient_name || row.paciente_nome || '',
    paciente_telefone: row.patient_phone || row.paciente_telefone || '',
    paciente_cpf: row.patient_cpf || row.paciente_cpf || '',
    paciente_email: row.patient_email || row.paciente_email || '',
    condicao: row.condition || row.condicao || '',
    medicacao_em_uso: row.medication_in_use || row.medicacao_em_uso || '',
    origem: row.source || row.origem || 'backend',
    pagamento_status: row.payment_status || row.pagamento_status || 'PENDENTE',
    risco: row.risk_level || row.risco || 'BAIXO',
    elegibilidade: row.eligibility || row.elegibilidade || null,
    dados_clinicos: clinical,
    motivo_decisao: row.decision_reason || row.motivo_decisao || null,
    medico_id: row.doctor_id || row.medico_id || null,
    criado_em: row.created_at || row.criado_em,
    atualizado_em: row.updated_at || row.atualizado_em
  };
}

function atendimentoToRow(atendimento = {}) {
  const clinical = atendimento.dados_clinicos || atendimento.clinical_data || {};
  return {
    id: atendimento.id,
    patient_id: atendimento.patient_id || null,
    patient_name: atendimento.paciente_nome,
    patient_phone: atendimento.paciente_telefone,
    patient_cpf: atendimento.paciente_cpf,
    patient_email: atendimento.paciente_email,
    condition: atendimento.condicao,
    medication_in_use: atendimento.medicacao_em_uso,
    source: atendimento.origem,
    status: atendimento.status,
    payment_status: atendimento.pagamento_status,
    risk_level: atendimento.risco,
    eligibility: atendimento.elegibilidade,
    clinical_data: clinical,
    decision_reason: atendimento.motivo_decisao,
    doctor_id: atendimento.medico_id,
    created_at: atendimento.criado_em,
    updated_at: atendimento.atualizado_em
  };
}

module.exports = {
  atendimentoToRow,
  rowToAtendimento
};
