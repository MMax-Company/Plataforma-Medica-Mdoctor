const { randomUUID } = require('crypto');
const { assertCanFallback, getSupabase } = require('../config/supabase');

const receitasLocal = [];

function hasSupabase() {
  try {
    getSupabase();
    return true;
  } catch {
    return false;
  }
}

function normalizeReceita(input = {}) {
  const now = new Date().toISOString();
  return {
    id: input.id || randomUUID(),
    atendimento_id: input.atendimento_id || input.atendimentoId,
    receita_id: input.receita_id || input.receitaId || null,
    protocolo: input.protocolo || input.protocol || null,
    receita_url: input.receita_url || input.receitaUrl || null,
    pdf_url: input.pdf_url || input.pdfUrl || null,
    storage_path: input.storage_path || input.storagePath || null,
    status: input.status || 'AWAITING_VALIDATION',
    provider: input.provider || 'Memed',
    payload: input.payload || {},
    medico_id: input.medico_id || input.medicoId || null,
    criado_em: input.criado_em || input.gerada_em || now,
    atualizado_em: input.atualizado_em || now
  };
}

async function createReceitaLog(input = {}) {
  const receita = normalizeReceita(input);

  if (hasSupabase()) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('receitas_memed')
      .insert(receita)
      .select('*')
      .single();

    if (!error && data) return normalizeReceita(data);
    assertCanFallback('registrar receita Memed', error);
    console.warn('Supabase receitas_memed fallback:', error?.message);
  }

  receitasLocal.unshift(receita);
  return receita;
}

async function listReceitasByAtendimento(atendimentoId) {
  if (hasSupabase()) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('receitas_memed')
      .select('*')
      .eq('atendimento_id', atendimentoId)
      .order('criado_em', { ascending: false });

    if (!error && data) return data.map(normalizeReceita);
    assertCanFallback('listar receitas Memed', error);
    console.warn('Supabase receitas_memed list fallback:', error?.message);
  }

  return receitasLocal
    .filter((receita) => receita.atendimento_id === atendimentoId)
    .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
}

module.exports = {
  createReceitaLog,
  listReceitasByAtendimento,
  normalizeReceita
};
