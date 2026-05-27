const { randomUUID } = require('crypto');
const { assertCanFallback, getSupabase, reportSupabaseError } = require('../config/supabase');
const { createAuditLog } = require('./audit.store');

const STATUS = {
  WAITING: 'waiting',
  EM_ATENDIMENTO: 'em_atendimento',
  MEMED_PROCESSING: 'memed_processing',
  READY: 'ready',
  DELIVERED: 'delivered',
  REJECTED: 'rejected',

  // Compatibility keys used by existing routes and older persisted rows.
  TRIAGED: 'waiting',
  QUEUE: 'waiting',
  UNDER_REVIEW: 'em_atendimento',
  AWAITING_VALIDATION: 'memed_processing',
  VALIDATED: 'ready',
  FINISHED: 'delivered',
  TRIAGEM: 'waiting',
  AGUARDANDO_PAGAMENTO: 'waiting',
  FILA: 'waiting',
  PRONTO_PARA_DECISAO: 'em_atendimento',
  APROVADO: 'ready',
  RECUSADO: 'rejected',
  RECEITA_EMITIDA: 'ready',
  CANCELADO: 'rejected'
};

const CANONICAL_STATUS = new Set([
  STATUS.WAITING,
  STATUS.EM_ATENDIMENTO,
  STATUS.MEMED_PROCESSING,
  STATUS.READY,
  STATUS.DELIVERED,
  STATUS.REJECTED
]);
const STATUS_ALIASES = {
  TRIAGED: STATUS.WAITING,
  TRIAGEM: STATUS.WAITING,
  QUEUE: STATUS.WAITING,
  FILA: STATUS.WAITING,
  WAITING: STATUS.WAITING,
  AGUARDANDO_PAGAMENTO: STATUS.WAITING,
  UNDER_REVIEW: STATUS.EM_ATENDIMENTO,
  EM_ATENDIMENTO: STATUS.EM_ATENDIMENTO,
  PRONTO_PARA_DECISAO: STATUS.EM_ATENDIMENTO,
  MEMED_PROCESSING: STATUS.MEMED_PROCESSING,
  AWAITING_VALIDATION: STATUS.MEMED_PROCESSING,
  VALIDATED: STATUS.READY,
  READY: STATUS.READY,
  APROVADO: STATUS.READY,
  RECEITA_EMITIDA: STATUS.READY,
  FINISHED: STATUS.DELIVERED,
  DELIVERED: STATUS.DELIVERED,
  RECUSADO: STATUS.REJECTED,
  INELEGIVEL: STATUS.REJECTED,
  REJECTED: STATUS.REJECTED,
  CANCELADO: STATUS.REJECTED
};
const VALID_STATUS = new Set([...CANONICAL_STATUS, ...Object.keys(STATUS_ALIASES)]);

const STATUS_GROUPS = {
  queue: [STATUS.WAITING],
  inMedicalFlow: [STATUS.EM_ATENDIMENTO, STATUS.MEMED_PROCESSING],
  readyToDeliver: [STATUS.READY],
  delivered: [STATUS.DELIVERED],
  rejected: [STATUS.REJECTED],
  terminal: [STATUS.DELIVERED, STATUS.REJECTED]
};

function normalizeStatus(status) {
  const rawValue = String(status || '').trim();
  if (!rawValue) return STATUS.WAITING;
  const canonical = rawValue.toLowerCase();
  if (CANONICAL_STATUS.has(canonical)) return canonical;
  const value = rawValue.toUpperCase();
  return STATUS_ALIASES[value] || value;
}

function statusInGroup(status, groupName) {
  return (STATUS_GROUPS[groupName] || []).includes(normalizeStatus(status));
}

const seedAtendimentos = [
  {
    id: randomUUID(),
    status: STATUS.QUEUE,
    paciente_nome: 'Paciente Demo',
    paciente_telefone: '+5511999999999',
    paciente_cpf: '',
    paciente_email: '',
    condicao: 'hipertensao',
    origem: 'demo',
    pagamento_status: 'CONFIRMADO',
    risco: 'BAIXO',
    elegibilidade: {
      eligible: true,
      reason: 'Paciente filtrado como baixo risco (Estável)'
    },
    dados_clinicos: {
      condition: 'hipertensao',
      previous_prescription: true,
      flags: []
    },
    motivo_decisao: null,
    medico_id: null,
    criado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString()
  }
];

let atendimentos = [...seedAtendimentos];
let decisoesLog = [];

function hasSupabase() {
  try {
    getSupabase();
    return true;
  } catch {
    return false;
  }
}

async function recordSupabaseFallback(context, error, payload = {}) {
  reportSupabaseError(error);
  await createAuditLog({
    entity_type: payload.entity_type || 'atendimento',
    entity_id: payload.entity_id || null,
    action: 'supabase_fallback_local',
    payload: {
      context,
      error: error?.message || String(error || 'Erro Supabase'),
      ...payload
    }
  });
}

function normalizeAtendimento(input = {}) {
  const now = new Date().toISOString();
  const clinical = input.dados_clinicos || input.clinicalData || {};
  const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');
  const name =
    firstValue(
      input.paciente_nome,
      input.nome,
      input.name,
      input.patientName,
      clinical.paciente_nome,
      clinical.nome,
      clinical.patientName
    ) ||
    'Paciente sem nome';
  const phone =
    firstValue(
      input.paciente_telefone,
      input.telefone,
      input.phone,
      input.patientPhone,
      input.from,
      clinical.paciente_telefone,
      clinical.telefone
    ) ||
    '';
  const condition =
    firstValue(
      input.condicao,
      input.condition,
      input.doenca_cronica,
      input.medicacao_em_uso,
      clinical.condition,
      clinical.doenca,
      clinical.tipo,
      clinical.medicacao_em_uso
    ) ||
    'renovacao_receita';
  const medication =
    firstValue(
      input.medicacao_em_uso,
      input.requestedMedication,
      input.medicamento,
      clinical.medicacao_em_uso,
      clinical.medicamento,
      clinical.requestedMedication
    ) ||
    '';
  const eligibility =
    input.elegibilidade ||
    input.eligibility ||
    (typeof input.elegivel === 'boolean'
      ? { eligible: input.elegivel, reason: input.motivo || null }
      : null);

  return {
    id: input.id || randomUUID(),
    status: normalizeStatus(input.status || STATUS.TRIAGED),
    paciente_nome: name,
    paciente_telefone: phone,
    paciente_cpf: input.paciente_cpf || input.cpf || input.patientDocument || '',
    paciente_email: input.paciente_email || input.email || input.patientEmail || '',
    condicao: condition,
    medicacao_em_uso: medication,
    origem: input.origem || input.source || 'panel',
    pagamento_status:
      typeof input.pagamento === 'boolean'
        ? input.pagamento
          ? 'CONFIRMADO'
          : 'PENDENTE'
        : input.pagamento_status || input.pagamento || input.paymentStatus || 'PENDENTE',
    risco: input.risco || input.riskLevel || 'BAIXO',
    elegibilidade: eligibility,
    dados_clinicos: {
      ...clinical,
      condition,
      previous_prescription: Boolean(
        clinical.previous_prescription ||
          input.previous_prescription ||
          input.last_prescription ||
          input.possui_comprovacao
      ),
      continuous_use_proof: Boolean(clinical.continuous_use_proof || input.continuous_use_proof),
      flags: Array.isArray(clinical.flags) ? clinical.flags : Array.isArray(input.flags) ? input.flags : [],
      doenca_cronica: input.doenca_cronica || clinical.doenca_cronica || null,
      medicacao_em_uso: medication || null
    },
    motivo_decisao: input.motivo_decisao || input.motivo || input.reason || null,
    medico_id: input.medico_id || input.doctorId || null,
    criado_em: input.criado_em || input.created_at || now,
    atualizado_em: input.atualizado_em || input.updated_at || now
  };
}

function fromSupabase(row = {}) {
  return normalizeAtendimento({
    ...row,
    dados_clinicos: row.dados_clinicos || {},
    elegibilidade: row.elegibilidade || null
  });
}

function toSupabase(row) {
  return {
    id: row.id,
    status: row.status,
    paciente_nome: row.paciente_nome,
    paciente_telefone: row.paciente_telefone,
    paciente_cpf: row.paciente_cpf,
    paciente_email: row.paciente_email,
    condicao: row.condicao,
    medicacao_em_uso: row.medicacao_em_uso,
    origem: row.origem,
    pagamento_status: row.pagamento_status,
    risco: row.risco,
    elegibilidade: row.elegibilidade,
    dados_clinicos: row.dados_clinicos,
    motivo_decisao: row.motivo_decisao,
    medico_id: row.medico_id,
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em
  };
}

function toLegacySupabaseUpdate(updates) {
  const clinical = updates.dados_clinicos || {};
  const legacy = {
    status: updates.status,
    updated_at: updates.atualizado_em,
    motivo: updates.motivo_decisao,
    risco: updates.risco,
    dados_clinicos: updates.dados_clinicos
  };

  if (updates.paciente_nome !== undefined) legacy.paciente_nome = updates.paciente_nome;
  if (updates.paciente_telefone !== undefined) legacy.paciente_telefone = updates.paciente_telefone;
  if (updates.paciente_cpf !== undefined) legacy.paciente_cpf = updates.paciente_cpf;
  if (updates.paciente_email !== undefined) legacy.paciente_email = updates.paciente_email;
  if (updates.condicao !== undefined) legacy.doenca_cronica = updates.condicao;
  if (updates.medicacao_em_uso !== undefined) legacy.medicacao_em_uso = updates.medicacao_em_uso;
  if (updates.pagamento_status !== undefined) legacy.pagamento = updates.pagamento_status === 'CONFIRMADO';
  if (clinical.data_nascimento !== undefined) legacy.paciente_data_nascimento = clinical.data_nascimento;
  if (clinical.endereco !== undefined) legacy.paciente_endereco = clinical.endereco;
  if (clinical.queixa_principal !== undefined) legacy.queixa_principal = clinical.queixa_principal;
  if (clinical.historico_clinico !== undefined) legacy.historia_clinica = clinical.historico_clinico;
  if (clinical.medicacao_em_uso !== undefined) legacy.medicacao_em_uso = clinical.medicacao_em_uso;
  if (clinical.conduta !== undefined) legacy.conduta_prescricao = clinical.conduta;
  if (clinical.foto_receita_url !== undefined) legacy.foto_receita_url = clinical.foto_receita_url;

  return Object.fromEntries(Object.entries(legacy).filter(([, value]) => value !== undefined));
}

async function listAtendimentos(filters = {}) {
  if (hasSupabase()) {
    const supabase = getSupabase();
    let query = supabase
      .from('atendimentos')
      .select('*')
      .order('criado_em', { ascending: false });

    const { data, error } = await query;
    if (!error && data) {
      const selected = filters.status
        ? new Set(String(filters.status).split(',').map((status) => normalizeStatus(status.trim())))
        : null;
      return data.map(fromSupabase).filter((item) => !selected || selected.has(item.status));
    }
    await recordSupabaseFallback('listar atendimentos', error, { entity_type: 'atendimento_list' });
    assertCanFallback('listar atendimentos', error);
    console.warn('Supabase atendimentos fallback:', error?.message);
  }

  const selected = filters.status
    ? new Set(String(filters.status).split(',').map((status) => normalizeStatus(status.trim())))
    : null;

  return atendimentos
    .filter((item) => !selected || selected.has(normalizeStatus(item.status)))
    .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
}

async function getAtendimento(id) {
  if (hasSupabase()) {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('atendimentos').select('*').eq('id', id).single();
    if (!error && data) return fromSupabase(data);
    await recordSupabaseFallback('buscar atendimento', error, { entity_id: id });
    assertCanFallback('buscar atendimento', error);
    console.warn('Supabase atendimento detail fallback:', error?.message);
  }

  return atendimentos.find((item) => item.id === id) || null;
}

async function createAtendimento(input) {
  const atendimento = normalizeAtendimento(input);

  if (hasSupabase()) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('atendimentos')
      .insert(toSupabase(atendimento))
      .select('*')
      .single();

    if (!error && data) return fromSupabase(data);
    await recordSupabaseFallback('criar atendimento', error, { entity_id: atendimento.id });
    assertCanFallback('criar atendimento', error);
    console.warn('Supabase atendimento insert fallback:', error?.message);
  }

  atendimentos.unshift(atendimento);
  return atendimento;
}

async function updateAtendimentoStatus(id, status, meta = {}) {
  const normalizedStatus = normalizeStatus(status);
  if (!VALID_STATUS.has(status) && !VALID_STATUS.has(normalizedStatus)) return null;

  const updates = {
    status: normalizedStatus,
    motivo_decisao: meta.motivo || meta.notes || meta.reason || null,
    medico_id: meta.medicoId || meta.doctorId || null,
    atualizado_em: new Date().toISOString()
  };
  if (meta.paciente_nome !== undefined) updates.paciente_nome = meta.paciente_nome;
  if (meta.paciente_telefone !== undefined) updates.paciente_telefone = meta.paciente_telefone;
  if (meta.paciente_cpf !== undefined) updates.paciente_cpf = meta.paciente_cpf;
  if (meta.paciente_email !== undefined) updates.paciente_email = meta.paciente_email;
  if (meta.condicao !== undefined) updates.condicao = meta.condicao;
  if (meta.medicacao_em_uso !== undefined) updates.medicacao_em_uso = meta.medicacao_em_uso;
  if (meta.pagamento_status !== undefined) updates.pagamento_status = meta.pagamento_status;
  if (meta.dados_clinicos) updates.dados_clinicos = meta.dados_clinicos;
  if (meta.elegibilidade) updates.elegibilidade = meta.elegibilidade;
  if (meta.risco) updates.risco = meta.risco;

  const localUpdates = {
    status: normalizedStatus,
    motivo_decisao: updates.motivo_decisao,
    medico_id: updates.medico_id,
    atualizado_em: updates.atualizado_em
  };
  if (updates.paciente_nome !== undefined) localUpdates.paciente_nome = updates.paciente_nome;
  if (updates.paciente_telefone !== undefined) localUpdates.paciente_telefone = updates.paciente_telefone;
  if (updates.paciente_cpf !== undefined) localUpdates.paciente_cpf = updates.paciente_cpf;
  if (updates.paciente_email !== undefined) localUpdates.paciente_email = updates.paciente_email;
  if (updates.condicao !== undefined) localUpdates.condicao = updates.condicao;
  if (updates.medicacao_em_uso !== undefined) localUpdates.medicacao_em_uso = updates.medicacao_em_uso;
  if (updates.pagamento_status !== undefined) localUpdates.pagamento_status = updates.pagamento_status;
  if (updates.dados_clinicos) localUpdates.dados_clinicos = updates.dados_clinicos;
  if (updates.elegibilidade) localUpdates.elegibilidade = updates.elegibilidade;
  if (updates.risco) localUpdates.risco = updates.risco;

  if (hasSupabase()) {
    const supabase = getSupabase();
    let { data, error } = await supabase
      .from('atendimentos')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error && /Could not find|schema cache|column/i.test(error.message || '')) {
      const legacyUpdates = toLegacySupabaseUpdate(updates);
      const retry = await supabase
        .from('atendimentos')
        .update(legacyUpdates)
        .eq('id', id)
        .select('*')
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (!error && data) return fromSupabase(data);
    await recordSupabaseFallback('atualizar atendimento', error, { entity_id: id, status: normalizedStatus });
    assertCanFallback('atualizar atendimento', error);
    console.warn('Supabase atendimento update fallback:', error?.message);
  }

  const index = atendimentos.findIndex((item) => item.id === id);
  if (index === -1) return null;

  atendimentos[index] = { ...atendimentos[index], ...localUpdates };
  return atendimentos[index];
}

async function createDecisaoLog(input = {}) {
  const rawMedicoId = input.medico_id || input.doctorId || null;
  const numericMedicoId =
    rawMedicoId !== null && rawMedicoId !== '' && /^\d+$/.test(String(rawMedicoId))
      ? Number(rawMedicoId)
      : null;

  const log = {
    id: input.id || randomUUID(),
    atendimento_id: input.atendimento_id,
    status_anterior: input.status_anterior || null,
    status_novo: normalizeStatus(input.status_novo),
    motivo: input.motivo || null,
    medico_id: numericMedicoId,
    snapshot: {
      ...(input.snapshot || {}),
      ...(rawMedicoId && !numericMedicoId ? { medico_auth_id: rawMedicoId } : {})
    },
    criado_em: input.criado_em || new Date().toISOString()
  };

  if (hasSupabase()) {
    try {
      const data = await createAuditLog({
        id: log.id,
        entity_type: 'atendimento',
        entity_id: log.atendimento_id,
        action: 'status_change',
        actor: rawMedicoId || 'backend',
        payload: log,
        created_at: log.criado_em
      });
      return {
        id: data.id,
        atendimento_id: log.atendimento_id,
        status_anterior: log.status_anterior,
        status_novo: log.status_novo,
        motivo: log.motivo,
        medico_id: log.medico_id,
        snapshot: log.snapshot,
        criado_em: data.created_at || log.criado_em
      };
    } catch (error) {
      await recordSupabaseFallback('registrar decisao', error, { entity_id: log.atendimento_id, status: log.status_novo });
      assertCanFallback('registrar decisao', error);
    }
  }

  decisoesLog.unshift(log);
  return log;
}

async function listDecisoesLog(atendimentoId) {
  if (hasSupabase()) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('decisoes_log')
      .select('*')
      .eq('atendimento_id', atendimentoId)
      .order('criado_em', { ascending: false });

    if (!error && data) {
      return data.map((row) => ({
        id: row.id,
        atendimento_id: row.atendimento_id,
        status_anterior: row.status_anterior || null,
        status_novo: row.status_novo || 'DECISAO',
        motivo: row.motivo || null,
        medico_id: row.medico_id || null,
        snapshot: row.snapshot || {},
        criado_em: row.criado_em
      }));
    }
    await recordSupabaseFallback('listar decisoes', error, { entity_id: atendimentoId });
    assertCanFallback('listar decisoes', error);
    console.warn('Supabase decisoes_log list fallback:', error?.message);
  }

  return decisoesLog
    .filter((log) => log.atendimento_id === atendimentoId)
    .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
}

async function listRecentDecisoesLog(limit = 30) {
  if (hasSupabase()) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('decisoes_log')
      .select('*')
      .order('criado_em', { ascending: false })
      .limit(limit);

    if (!error && data) {
      return data.map((row) => ({
        id: row.id,
        atendimento_id: row.atendimento_id,
        status_anterior: row.status_anterior || null,
        status_novo: row.status_novo || 'DECISAO',
        motivo: row.motivo || null,
        medico_id: row.medico_id || null,
        snapshot: row.snapshot || {},
        criado_em: row.criado_em
      }));
    }
    await recordSupabaseFallback('listar decisoes recentes', error, { entity_type: 'decisoes_log' });
    assertCanFallback('listar decisoes recentes', error);
    console.warn('Supabase decisoes_log recent fallback:', error?.message);
  }

  return decisoesLog
    .slice()
    .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)))
    .slice(0, limit);
}

async function createEntregaReceitaLog(input = {}) {
  const log = {
    id: input.id,
    atendimento_id: input.atendimento_id,
    canal: input.canal || input.channel,
    provider: input.provider || null,
    provider_message_id: input.provider_message_id || input.providerMessageId || null,
    status: input.status || 'sent',
    target_masked: input.target_masked || input.targetMasked || null,
    erro: input.erro || input.error || null,
    snapshot: input.snapshot || {},
    criado_em: input.criado_em || input.sent_at || input.attempted_at || new Date().toISOString()
  };

  if (hasSupabase()) {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('entregas_receita').insert(log).select('*').single();
    if (!error && data) return data;
    await recordSupabaseFallback('registrar entrega de receita', error, { entity_id: log.atendimento_id, entity_type: 'entrega_receita' });
    assertCanFallback('registrar entrega de receita', error);
    console.warn('Supabase entregas_receita fallback:', error?.message);
  }

  return log;
}

module.exports = {
  STATUS,
  STATUS_GROUPS,
  normalizeStatus,
  statusInGroup,
  VALID_STATUS,
  listAtendimentos,
  getAtendimento,
  createAtendimento,
  updateAtendimentoStatus,
  createDecisaoLog,
  listDecisoesLog,
  listRecentDecisoesLog,
  createEntregaReceitaLog
};
