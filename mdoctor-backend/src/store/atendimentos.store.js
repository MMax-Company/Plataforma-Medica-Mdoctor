const { randomUUID } = require('crypto');
const T = require('../db/tables');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveDeliveryLogId(rawId) {
  if (rawId && UUID_PATTERN.test(String(rawId))) return String(rawId);
  return randomUUID();
}
const { dbQuery } = require('../db/persistence');
const { getAppointmentTable } = require('../db/resolve-tables');
const { rowToAtendimento, atendimentoToRow } = require('../db/appointment-mapper');
const { createAuditLog } = require('./audit.store');

const STATUS = {
  WAITING: 'waiting',
  AWAITING_PRESCRIPTION_UPLOAD: 'awaiting_prescription_upload',
  EM_ATENDIMENTO: 'em_atendimento',
  APPROVED: 'approved',
  RECEITA_EM_EDICAO: 'receita_em_edicao',
  RECEITA_EMITIDA: 'receita_emitida',
  MEMED_PROCESSING: 'memed_processing',
  READY: 'ready',
  DELIVERED: 'delivered',
  REJECTED: 'rejected',

  // Compatibility keys used by existing routes and older persisted rows.
  TRIAGED: 'waiting',
  QUEUE: 'waiting',
  UNDER_REVIEW: 'em_atendimento',
  AWAITING_VALIDATION: 'receita_emitida',
  VALIDATED: 'ready',
  FINISHED: 'delivered',
  TRIAGEM: 'waiting',
  AGUARDANDO_PAGAMENTO: 'waiting',
  FILA: 'waiting',
  PRONTO_PARA_DECISAO: 'em_atendimento',
  APROVADO: 'ready',
  RECUSADO: 'rejected',
  CANCELADO: 'rejected'
};

const CANONICAL_STATUS = new Set([
  STATUS.WAITING,
  STATUS.AWAITING_PRESCRIPTION_UPLOAD,
  STATUS.EM_ATENDIMENTO,
  STATUS.APPROVED,
  STATUS.RECEITA_EM_EDICAO,
  STATUS.RECEITA_EMITIDA,
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
  AWAITING_PRESCRIPTION_UPLOAD: STATUS.AWAITING_PRESCRIPTION_UPLOAD,
  AGUARDANDO_RECEITA: STATUS.AWAITING_PRESCRIPTION_UPLOAD,
  UNDER_REVIEW: STATUS.EM_ATENDIMENTO,
  EM_ATENDIMENTO: STATUS.EM_ATENDIMENTO,
  PRONTO_PARA_DECISAO: STATUS.EM_ATENDIMENTO,
  APPROVED: STATUS.APPROVED,
  RECEITA_EM_EDICAO: STATUS.RECEITA_EM_EDICAO,
  RECEITA_EMITIDA: STATUS.RECEITA_EMITIDA,
  MEMED_PROCESSING: STATUS.RECEITA_EMITIDA,
  AWAITING_VALIDATION: STATUS.RECEITA_EMITIDA,
  VALIDATED: STATUS.READY,
  READY: STATUS.READY,
  APROVADO: STATUS.READY,
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
  inMedicalFlow: [
    STATUS.EM_ATENDIMENTO,
    STATUS.APPROVED,
    STATUS.RECEITA_EM_EDICAO,
    STATUS.RECEITA_EMITIDA,
    STATUS.MEMED_PROCESSING
  ],
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

/** Mapeia status canônico → valor persistido no Supabase (check constraint legado). */
function toPersistedStatus(canonicalStatus) {
  const canonical = normalizeStatus(canonicalStatus);
  if (canonical === STATUS.APPROVED) return 'em_atendimento';
  if (canonical === STATUS.RECEITA_EM_EDICAO) return 'memed_processing';
  if (canonical === STATUS.RECEITA_EMITIDA) return 'RECEITA_EMITIDA';
  if (canonical === STATUS.READY) return 'APROVADO';
  if (canonical === STATUS.DELIVERED) return 'DELIVERED';
  return canonical;
}

/** Deriva status canônico lógico a partir do row persistido + dados_clinicos. */
function resolveEffectiveStatus(storedStatus, dados_clinicos = {}) {
  const clinical = dados_clinicos || {};
  const ctx = clinical.memed_context || {};
  const stored = String(storedStatus || '').trim();
  const normalizedStored = normalizeStatus(stored);

  if (
    normalizedStored === STATUS.DELIVERED ||
    stored === 'DELIVERED' ||
    stored === 'FINISHED' ||
    clinical.entrega_receita?.status === 'sent' ||
    (Array.isArray(clinical.entregas_receita) &&
      clinical.entregas_receita.some((item) => item?.status === 'sent'))
  ) {
    return STATUS.DELIVERED;
  }

  if (
    normalizedStored === STATUS.READY ||
    stored === 'APROVADO' ||
    stored === 'VALIDATED' ||
    clinical.memed_receita?.validated_at
  ) {
    return STATUS.READY;
  }

  if (stored === 'RECEITA_EMITIDA' || normalizedStored === STATUS.RECEITA_EMITIDA) {
    return STATUS.RECEITA_EMITIDA;
  }

  if (
    ctx.fluxo === 'sinapse_widget' ||
    ctx.pendente_emissao === true ||
    clinical.clinical_audit?.decision === 'approved'
  ) {
    if (clinical.memed_receita?.receitaId || clinical.memed_receita?.memed_id) {
      return STATUS.RECEITA_EMITIDA;
    }
    if (ctx.emissao_iniciada_em || normalizedStored === STATUS.MEMED_PROCESSING || stored === 'memed_processing') {
      return STATUS.RECEITA_EM_EDICAO;
    }
    return STATUS.APPROVED;
  }

  return normalizedStored;
}

function statusInGroup(status, groupName) {
  return (STATUS_GROUPS[groupName] || []).includes(normalizeStatus(status));
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
    patient_id: input.patient_id || input.patientId || null,
    status: resolveEffectiveStatus(input.status, clinical),
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
    numero_curto: input.numero_curto ?? null,
    criado_em: input.criado_em || input.created_at || now,
    atualizado_em: input.atualizado_em || input.updated_at || now
  };
}

function fromSupabase(row = {}) {
  if (row.paciente_nome || row.dados_clinicos) {
    return normalizeAtendimento({
      ...row,
      dados_clinicos: row.dados_clinicos || row.clinical_data || {},
      status: resolveEffectiveStatus(row.status, row.dados_clinicos || row.clinical_data)
    });
  }
  const mapped = rowToAtendimento(row);
  return normalizeAtendimento({
    ...mapped,
    status: resolveEffectiveStatus(mapped.status, mapped.dados_clinicos)
  });
}

async function mirrorToAppointments(rawRowOrAtendimento) {
  const atendimento =
    rawRowOrAtendimento?.paciente_nome != null
      ? rawRowOrAtendimento
      : fromSupabase(rawRowOrAtendimento || {});
  const row = atendimentoToRow(atendimento);
  row.updated_at = new Date().toISOString();
  await dbQuery('espelhar appointment oficial', async (supabase) =>
    supabase.from(T.APPOINTMENTS).upsert(row, { onConflict: 'id' })
  );
}

function toStorageRow(atendimento, table) {
  if (table === 'atendimentos') {
    return {
      id: atendimento.id,
      patient_id: atendimento.patient_id || null,
      status: toPersistedStatus(atendimento.status),
      paciente_nome: atendimento.paciente_nome,
      paciente_telefone: atendimento.paciente_telefone,
      paciente_cpf: atendimento.paciente_cpf,
      paciente_email: atendimento.paciente_email,
      condicao: atendimento.condicao,
      medicacao_em_uso: atendimento.medicacao_em_uso,
      origem: atendimento.origem,
      pagamento_status: atendimento.pagamento_status,
      risco: atendimento.risco,
      elegibilidade: atendimento.elegibilidade,
      dados_clinicos: atendimento.dados_clinicos,
      motivo_decisao: atendimento.motivo_decisao,
      medico_id: atendimento.medico_id,
      criado_em: atendimento.criado_em,
      atualizado_em: atendimento.atualizado_em
    };
  }
  return {
    ...atendimentoToRow(atendimento),
    status: toPersistedStatus(atendimento.status)
  };
}

async function listAtendimentos(filters = {}) {
  const table = await getAppointmentTable();
  const orderCol = table === 'atendimentos' ? 'criado_em' : 'created_at';
  const data = await dbQuery('listar appointments', async (supabase) =>
    supabase.from(table).select('*').order(orderCol, { ascending: false })
  );
  const selected = filters.status
    ? new Set(String(filters.status).split(',').map((status) => normalizeStatus(status.trim())))
    : null;
  return (data || []).map(fromSupabase).filter((item) => !selected || selected.has(item.status));
}

async function getAtendimento(id) {
  const table = await getAppointmentTable();
  let data = await dbQuery('buscar appointment', async (supabase) =>
    supabase.from(table).select('*').eq('id', id).maybeSingle()
  );
  if (!data && table === T.APPOINTMENTS) {
    data = await dbQuery('buscar appointment legado', async (supabase) =>
      supabase.from('atendimentos').select('*').eq('id', id).maybeSingle()
    );
    if (data) {
      try {
        await mirrorToAppointments(data);
      } catch {
        /* não bloqueia leitura */
      }
    }
  }
  return data ? fromSupabase(data) : null;
}

async function linkPatientToAppointment(appointmentId, patientId) {
  if (!appointmentId || !patientId) return null;
  const table = await getAppointmentTable();
  const patch =
    table === 'atendimentos'
      ? { patient_id: patientId }
      : { patient_id: patientId, updated_at: new Date().toISOString() };
  const data = await dbQuery('vincular patient appointment', async (supabase) =>
    supabase.from(table).update(patch).eq('id', appointmentId).select('*').maybeSingle()
  );
  return data ? fromSupabase(data) : null;
}

async function createAtendimento(input) {
  const atendimento = normalizeAtendimento(input);
  const table = await getAppointmentTable();
  const row = toStorageRow(atendimento, table);
  const data = await dbQuery('criar appointment', async (supabase) =>
    supabase.from(table).insert(row).select('*').single()
  );
  const created = fromSupabase(data);
  if (table === 'atendimentos') {
    try {
      await mirrorToAppointments(created);
    } catch {
      /* espelhamento best-effort */
    }
  }
  if (created?.id && atendimento.patient_id && !created.patient_id) {
    return (await linkPatientToAppointment(created.id, atendimento.patient_id)) || created;
  }
  return created;
}

function resolveMedicoIdForDb(rawMedicoId) {
  if (rawMedicoId === null || rawMedicoId === undefined || rawMedicoId === '') return null;
  return /^\d+$/.test(String(rawMedicoId)) ? Number(rawMedicoId) : null;
}

async function updateAtendimentoStatus(id, status, meta = {}) {
  const normalizedStatus = normalizeStatus(status);
  if (!VALID_STATUS.has(status) && !VALID_STATUS.has(normalizedStatus)) return null;

  const medicoId = resolveMedicoIdForDb(meta.medicoId || meta.doctorId || null);
  const persistedStatus = toPersistedStatus(normalizedStatus);

  const updates = {
    status: persistedStatus,
    motivo_decisao: meta.motivo || meta.notes || meta.reason || null,
    medico_id: medicoId,
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

  const table = await getAppointmentTable();
  const dbUpdates =
    table === 'atendimentos'
      ? {
          status: persistedStatus,
          motivo_decisao: updates.motivo_decisao,
          medico_id: updates.medico_id,
          atualizado_em: updates.atualizado_em,
          ...(updates.paciente_nome !== undefined ? { paciente_nome: updates.paciente_nome } : {}),
          ...(updates.paciente_telefone !== undefined ? { paciente_telefone: updates.paciente_telefone } : {}),
          ...(updates.paciente_cpf !== undefined ? { paciente_cpf: updates.paciente_cpf } : {}),
          ...(updates.paciente_email !== undefined ? { paciente_email: updates.paciente_email } : {}),
          ...(updates.condicao !== undefined ? { condicao: updates.condicao } : {}),
          ...(updates.medicacao_em_uso !== undefined ? { medicacao_em_uso: updates.medicacao_em_uso } : {}),
          ...(updates.pagamento_status !== undefined ? { pagamento_status: updates.pagamento_status } : {}),
          ...(updates.dados_clinicos ? { dados_clinicos: updates.dados_clinicos } : {}),
          ...(updates.elegibilidade ? { elegibilidade: updates.elegibilidade } : {}),
          ...(updates.risco ? { risco: updates.risco } : {})
        }
      : {
          status: persistedStatus,
          decision_reason: updates.motivo_decisao,
          doctor_id: updates.medico_id ? String(updates.medico_id) : null,
          updated_at: updates.atualizado_em,
          ...(updates.paciente_nome !== undefined ? { patient_name: updates.paciente_nome } : {}),
          ...(updates.paciente_telefone !== undefined ? { patient_phone: updates.paciente_telefone } : {}),
          ...(updates.paciente_cpf !== undefined ? { patient_cpf: updates.paciente_cpf } : {}),
          ...(updates.paciente_email !== undefined ? { patient_email: updates.paciente_email } : {}),
          ...(updates.condicao !== undefined ? { condition: updates.condicao } : {}),
          ...(updates.medicacao_em_uso !== undefined ? { medication_in_use: updates.medicacao_em_uso } : {}),
          ...(updates.pagamento_status !== undefined ? { payment_status: updates.pagamento_status } : {}),
          ...(updates.dados_clinicos ? { clinical_data: updates.dados_clinicos } : {}),
          ...(updates.elegibilidade ? { eligibility: updates.elegibilidade } : {}),
          ...(updates.risco ? { risk_level: updates.risco } : {})
        };

  const data = await dbQuery('atualizar appointment', async (supabase) =>
    supabase.from(table).update(dbUpdates).eq('id', id).select('*').maybeSingle()
  );
  if (!data) return null;
  if (table === 'atendimentos') {
    try {
      await mirrorToAppointments(data);
    } catch {
      /* espelhamento best-effort */
    }
  }

  try {
    await dbQuery('histórico status appointment', async (supabase) =>
      supabase.from(T.APPOINTMENT_STATUS_HISTORY).insert({
      appointment_id: id,
      previous_status: meta.status_anterior || null,
      new_status: normalizedStatus,
      reason: dbUpdates.decision_reason,
      doctor_id: dbUpdates.doctor_id,
      snapshot: meta.snapshot || {}
      })
    );
  } catch {
    // histórico opcional até migration 20260601 completa
  }

  return fromSupabase(data);
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

  const data = await dbQuery('registrar decisão médica', async (supabase) =>
    supabase
      .from(T.MEDICAL_DECISIONS)
      .insert({
        id: log.id,
        appointment_id: log.atendimento_id,
        previous_status: log.status_anterior,
        new_status: log.status_novo,
        decision_type: 'status_change',
        reason: log.motivo,
        doctor_id: rawMedicoId ? String(rawMedicoId) : null,
        snapshot: log.snapshot
      })
      .select('*')
      .single()
  );

  await createAuditLog({
    entity_type: 'appointment',
    entity_id: log.atendimento_id,
    action: 'medical_decision',
    actor: rawMedicoId || 'backend',
    payload: log
  });

  return {
    id: data.id,
    atendimento_id: data.appointment_id,
    status_anterior: data.previous_status,
    status_novo: data.new_status,
    motivo: data.reason,
    medico_id: data.doctor_id,
    snapshot: data.snapshot,
    criado_em: data.created_at
  };
}

async function listDecisoesLog(atendimentoId) {
  const data = await dbQuery('listar decisões', async (supabase) =>
    supabase
      .from(T.MEDICAL_DECISIONS)
      .select('*')
      .eq('appointment_id', atendimentoId)
      .order('created_at', { ascending: false })
  );
  return (data || []).map((row) => ({
    id: row.id,
    atendimento_id: row.appointment_id,
    status_anterior: row.previous_status || null,
    status_novo: row.new_status || 'DECISAO',
    motivo: row.reason || null,
    medico_id: row.doctor_id || null,
    snapshot: row.snapshot || {},
    criado_em: row.created_at
  }));
}

async function listRecentDecisoesLog(limit = 30) {
  const data = await dbQuery('listar decisões recentes', async (supabase) =>
    supabase.from(T.MEDICAL_DECISIONS).select('*').order('created_at', { ascending: false }).limit(limit)
  );
  return (data || []).map((row) => ({
    id: row.id,
    atendimento_id: row.appointment_id,
    status_anterior: row.previous_status || null,
    status_novo: row.new_status || 'DECISAO',
    motivo: row.reason || null,
    medico_id: row.doctor_id || null,
    snapshot: row.snapshot || {},
    criado_em: row.created_at
  }));
}

async function createEntregaReceitaLog(input = {}) {
  const log = {
    id: resolveDeliveryLogId(input.id),
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

  try {
    const data = await dbQuery('registrar entrega', async (supabase) =>
      supabase
        .from(T.PRESCRIPTION_DELIVERY)
        .insert({
          id: log.id,
          appointment_id: log.atendimento_id,
          channel: log.canal,
          provider: log.provider,
          provider_message_id: log.provider_message_id,
          status: log.status,
          target_masked: log.target_masked,
          error_message: log.erro,
          snapshot: log.snapshot,
          delivered_at: log.status === 'sent' ? log.criado_em : null
        })
        .select('*')
        .single()
    );
    return data;
  } catch (error) {
    if (!/Could not find the table|schema cache/i.test(error.message || '')) throw error;
    return dbQuery('registrar entrega legado', async (supabase) =>
      supabase
        .from('entregas_receita')
        .insert({
          id: log.id,
          atendimento_id: log.atendimento_id,
          canal: log.canal,
          provider: log.provider,
          provider_message_id: log.provider_message_id,
          status: log.status,
          target_masked: log.target_masked,
          erro: log.erro,
          snapshot: log.snapshot,
          criado_em: log.criado_em
        })
        .select('*')
        .single()
    );
  }
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
  linkPatientToAppointment,
  updateAtendimentoStatus,
  createDecisaoLog,
  listDecisoesLog,
  listRecentDecisoesLog,
  createEntregaReceitaLog
};
