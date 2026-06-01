const T = require('../db/tables');
const { dbQuery } = require('../db/persistence');
const { normalizePrescription, savePrescription } = require('./prescriptions.store');

function normalizeReceita(input = {}) {
  const p = normalizePrescription({
    ...input,
    provider: input.provider || 'memed',
    status: input.status || 'issued',
    provider_prescription_id: input.receita_id || input.receitaId,
    pdf_url: input.pdf_url || input.receita_url,
    payload: {
      ...(input.payload || {}),
      protocolo: input.protocolo || input.protocol || null,
      storage_path: input.storage_path || input.storagePath || null
    },
    issued_by_doctor_id: input.medico_id || input.medicoId,
    issued_at: input.criado_em || input.gerada_em
  });
  return {
    id: p.id,
    atendimento_id: p.appointment_id,
    receita_id: p.provider_prescription_id,
    protocolo: input.protocolo || null,
    receita_url: p.pdf_url,
    pdf_url: p.pdf_url,
    storage_path: input.storage_path || null,
    status: p.status,
    provider: p.provider,
    payload: p.payload,
    medico_id: p.issued_by_doctor_id,
    criado_em: p.created_at,
    atualizado_em: p.updated_at
  };
}

async function createReceitaLog(input = {}) {
  const saved = await savePrescription({
    ...input,
    atendimento_id: input.atendimento_id || input.atendimentoId,
    provider: 'memed'
  });
  return normalizeReceita(saved);
}

async function listReceitasByAtendimento(atendimentoId) {
  const data = await dbQuery('listar receitas', async (supabase) =>
    supabase
      .from(T.PRESCRIPTIONS)
      .select('*')
      .or(`appointment_id.eq.${atendimentoId},atendimento_id.eq.${atendimentoId}`)
      .eq('provider', 'memed')
      .order('created_at', { ascending: false })
  );
  return (data || []).map(normalizeReceita);
}

module.exports = {
  createReceitaLog,
  listReceitasByAtendimento,
  normalizeReceita
};
