const { STATUS, createAtendimento, listAtendimentos, getAtendimento, updateAtendimentoStatus } = require('../store/atendimentos.store');
const { createAuditLog } = require('../store/audit.store');
const { recordSupportTicket, recordWhatsappMessage } = require('./clinical-persistence.service');
const { isSupportQueue, QUEUE_TYPE_SUPPORT } = require('../constants/whatsapp-queue');
const logger = require('../config/logger');

const SUPPORT_TIMEOUT_MS = Number(process.env.SUPPORT_INACTIVITY_TIMEOUT_MS || 30 * 60 * 1000);

const SUPPORT_WAITING_REPLY =
  'Aguarde, em breve nossa equipe realizará seu atendimento.\n\n*0* - Voltar ao menu inicial\n*ENCERRAR* - Encerrar atendimento';

const SUPPORT_ALREADY_OPEN_REPLY =
  'Você já está na fila de suporte. Aguarde o contato da equipe.';

const SUPPORT_IN_QUEUE_REPLY =
  'Você está na fila de suporte. Nossa equipe entrará em contato em breve.\n\n*0* - Cancelar e voltar ao menu inicial\n*ENCERRAR* - Encerrar atendimento';

const SUPPORT_SUB = {
  WAITING: 'waiting',
  EM_ATENDIMENTO: 'em_atendimento',
  AWAITING_DECISION: 'awaiting_patient_decision',
  CLOSED_PATIENT: 'closed_by_patient',
  CONVERTED: 'converted_to_renewal',
  INACTIVE: 'closed_inactive'
};

function getSupportSubStatus(atendimento = {}) {
  return String(atendimento?.dados_clinicos?.support_sub_status || SUPPORT_SUB.WAITING);
}

function normalizePhone(value = '') {
  return String(value).replace(/\D/g, '').trim();
}

function supportIsOpen(atendimento) {
  const status = String(atendimento?.status || '').toLowerCase();
  const sub = getSupportSubStatus(atendimento);
  return status === STATUS.WAITING || status === STATUS.EM_ATENDIMENTO || sub === SUPPORT_SUB.AWAITING_DECISION;
}

async function findOpenSupportByPhone(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return null;

  const rows = await listAtendimentos();
  return (
    rows.find((item) => {
      if (!isSupportQueue(item)) return false;
      if (!supportIsOpen(item)) return false;
      return normalizePhone(item.paciente_telefone) === digits;
    }) || null
  );
}

async function findSupportByCreationIdempotencyKey(idempotencyKey) {
  const normalized = String(idempotencyKey || '').trim();
  if (!normalized) return null;

  const rows = await listAtendimentos();
  return (
    rows.find((item) => {
      if (!isSupportQueue(item)) return false;
      const stored = String(item.dados_clinicos?.idempotency_key || '').trim();
      return stored && stored === normalized;
    }) || null
  );
}

async function logSupportInboundMessage({ phone, text, atendimentoId = null }) {
  const digits = normalizePhone(phone);
  if (!digits || !String(text || '').trim()) return;
  logger.info('whatsapp_support_inbound_message', {
    atendimento_id: atendimentoId || null,
    phone: digits.replace(/\d(?=\d{4})/g, '*'),
    body_length: String(text).length
  });
  await recordWhatsappMessage({
    appointmentId: atendimentoId,
    phone: digits,
    body: String(text),
    direction: 'inbound',
    status: 'received',
    metadata: { channel: 'whatsapp_support' }
  }).catch(() => {});
}

async function createWhatsAppSupportEntry({ phone, correlationId, idempotencyKey, requestId }) {
  const digits = normalizePhone(phone);
  if (!digits) {
    const error = new Error('telefone obrigatório');
    error.statusCode = 400;
    throw error;
  }

  const idempotency = String(idempotencyKey || '').trim();
  if (idempotency) {
    const byKey = await findSupportByCreationIdempotencyKey(idempotency);
    if (byKey) {
      return {
        duplicate: true,
        idempotentReplay: true,
        atendimento: byKey,
        reply: supportIsOpen(byKey) ? SUPPORT_ALREADY_OPEN_REPLY : 'Solicitação de suporte já registrada.'
      };
    }
  }

  const existing = await findOpenSupportByPhone(digits);
  if (existing) {
    return { duplicate: true, atendimento: existing, reply: SUPPORT_ALREADY_OPEN_REPLY };
  }

  const suffix = digits.slice(-4);
  const atendimento = await createAtendimento({
    paciente_nome: `Suporte WhatsApp ${suffix}`,
    paciente_telefone: digits,
    paciente_cpf: '',
    paciente_email: '',
    condicao: 'suporte_whatsapp',
    medicacao_em_uso: '',
    origem: 'whatsapp',
    status: STATUS.WAITING,
    pagamento_status: 'CONFIRMADO',
    risco: 'BAIXO',
    elegibilidade: {
      eligible: false,
      reason: 'Aguardando atendimento humano via WhatsApp',
      reasonCode: 'human_support',
      riskLevel: 'BAIXO',
      protocolVersion: 'whatsapp-support-v1'
    },
    dados_clinicos: {
      queue_type: QUEUE_TYPE_SUPPORT,
      whatsapp_support: true,
      correlationId: correlationId || null,
      idempotency_key: idempotencyKey || null,
      opened_at: new Date().toISOString()
    }
  });

  await recordSupportTicket({
    appointmentId: atendimento.id,
    phone: digits,
    subject: `Suporte WhatsApp ${suffix}`,
    metadata: {
      correlationId: correlationId || null,
      idempotency_key: idempotencyKey || null
    }
  });

  await createAuditLog({
    entity_type: 'whatsapp_support',
    entity_id: atendimento.id,
    action: 'support_queue_created',
    actor: 'n8n',
    payload: {
      requestId: requestId || null,
      correlationId: correlationId || null,
      phone: digits.replace(/\d(?=\d{4})/g, '*'),
      atendimento_id: atendimento.id
    }
  });

  return {
    duplicate: false,
    atendimento,
    reply: SUPPORT_WAITING_REPLY
  };
}

async function closeWhatsAppSupportEntry({ phone, correlationId, requestId }) {
  const digits = normalizePhone(phone);
  const existing = await findOpenSupportByPhone(digits);

  if (!existing) {
    return { closed: false, atendimento: null, reply: 'Nenhum atendimento de suporte ativo encontrado.' };
  }

  const updated = await updateAtendimentoStatus(existing.id, STATUS.REJECTED, {
    motivo: 'Encerrado pelo paciente via WhatsApp',
    dados_clinicos: {
      ...(existing.dados_clinicos || {}),
      support_closed_at: new Date().toISOString(),
      support_closed_by: 'patient'
    }
  });

  await createAuditLog({
    entity_type: 'whatsapp_support',
    entity_id: existing.id,
    action: 'support_queue_closed',
    actor: 'n8n',
    payload: {
      requestId: requestId || null,
      correlationId: correlationId || null,
      phone: digits.replace(/\d(?=\d{4})/g, '*')
    }
  });

  return {
    closed: true,
    atendimento: updated,
    reply: 'Atendimento de suporte encerrado. Obrigado pelo contato.'
  };
}

async function listWhatsAppSupportQueue() {
  const rows = await listAtendimentos();
  return rows
    .filter((item) => isSupportQueue(item) && supportIsOpen(item))
    .sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
}

async function startSupportAttendance(atendimentoId) {
  const atendimento = await getAtendimento(atendimentoId);
  if (!atendimento) { const e = new Error('Atendimento não encontrado'); e.statusCode = 404; throw e; }
  if (!isSupportQueue(atendimento)) { const e = new Error('Atendimento não é de suporte'); e.statusCode = 400; throw e; }

  const updated = await updateAtendimentoStatus(atendimentoId, STATUS.EM_ATENDIMENTO, {
    dados_clinicos: {
      ...(atendimento.dados_clinicos || {}),
      support_sub_status: SUPPORT_SUB.EM_ATENDIMENTO,
      support_started_at: new Date().toISOString()
    }
  });

  await createAuditLog({
    entity_type: 'whatsapp_support', entity_id: atendimentoId,
    action: 'support_attendance_started', actor: 'panel',
    payload: { atendimento_id: atendimentoId }
  });

  return updated;
}

async function finalizeSupportAttendance(atendimentoId) {
  const atendimento = await getAtendimento(atendimentoId);
  if (!atendimento) { const e = new Error('Atendimento não encontrado'); e.statusCode = 404; throw e; }
  if (!isSupportQueue(atendimento)) { const e = new Error('Atendimento não é de suporte'); e.statusCode = 400; throw e; }

  const deadline = new Date(Date.now() + SUPPORT_TIMEOUT_MS).toISOString();
  const FINALIZATION_TEXT =
    'Seu atendimento de suporte foi finalizado.\n\nDigite:\n*1* - Encerrar atendimento\n*2* - Iniciar avaliação para renovação de receita';

  await updateAtendimentoStatus(atendimentoId, STATUS.WAITING, {
    dados_clinicos: {
      ...(atendimento.dados_clinicos || {}),
      support_sub_status: SUPPORT_SUB.AWAITING_DECISION,
      support_finalized_at: new Date().toISOString(),
      support_decision_deadline: deadline
    }
  });

  // Best-effort send via provider WhatsApp configurado (meta)
  const phone = atendimento.paciente_telefone;
  if (phone) {
    try {
      const { sendWhatsAppText } = require('../delivery/delivery.service');
      await sendWhatsAppText({ to: phone, text: FINALIZATION_TEXT });
    } catch (e) {
      logger.warn('support_finalization_send_failed', { atendimentoId, error: e.message });
    }
  }

  await createAuditLog({
    entity_type: 'whatsapp_support', entity_id: atendimentoId,
    action: 'support_attendance_finalized', actor: 'panel',
    payload: { atendimento_id: atendimentoId, decision_deadline: deadline }
  });

  return { messageText: FINALIZATION_TEXT };
}

async function getPatientSupportContext(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return null;

  const rows = await listAtendimentos();
  const match = rows.find((item) => {
    if (!isSupportQueue(item)) return false;
    if (!supportIsOpen(item)) return false;
    return normalizePhone(item.paciente_telefone) === digits;
  });

  if (!match) return null;

  return {
    atendimento_id: match.id,
    status: match.status,
    support_sub_status: getSupportSubStatus(match),
    opened_at: match.dados_clinicos?.opened_at || match.criado_em
  };
}

async function respondToFinalization(phone, choice, { inlineTypebot = false } = {}) {
  const digits = normalizePhone(phone);
  const rows = await listAtendimentos();
  const match = rows.find((item) => {
    if (!isSupportQueue(item)) return false;
    return getSupportSubStatus(item) === SUPPORT_SUB.AWAITING_DECISION
      && normalizePhone(item.paciente_telefone) === digits;
  });

  if (!match) {
    return { handled: false, reply: 'Nenhum atendimento aguardando decisão. Digite *2* para acessar o suporte.' };
  }

  const choiceStr = String(choice || '').trim();

  if (choiceStr === '1') {
    await updateAtendimentoStatus(match.id, STATUS.REJECTED, {
      dados_clinicos: {
        ...(match.dados_clinicos || {}),
        support_sub_status: SUPPORT_SUB.CLOSED_PATIENT,
        support_closed_at: new Date().toISOString(),
        support_closed_by: 'patient'
      }
    });
    await createAuditLog({
      entity_type: 'whatsapp_support', entity_id: match.id,
      action: 'support_closed_by_patient', actor: 'n8n',
      payload: { phone: digits.replace(/\d(?=\d{4})/g, '*') }
    });
    return { handled: true, sub_status: SUPPORT_SUB.CLOSED_PATIENT, reply: 'Atendimento encerrado. Obrigado pelo contato com o Doctor Prescreve! Até logo.' };
  }

  if (choiceStr === '2') {
    await updateAtendimentoStatus(match.id, STATUS.REJECTED, {
      dados_clinicos: {
        ...(match.dados_clinicos || {}),
        support_sub_status: SUPPORT_SUB.CONVERTED,
        support_converted_at: new Date().toISOString()
      }
    });
    await createAuditLog({
      entity_type: 'whatsapp_support', entity_id: match.id,
      action: 'support_converted_to_renewal', actor: 'n8n',
      payload: { phone: digits.replace(/\d(?=\d{4})/g, '*') }
    });
    if (inlineTypebot) {
      return { handled: true, sub_status: SUPPORT_SUB.CONVERTED, startTypebot: true };
    }
    // Legado sem inline: não envia link público — atendimento só via WhatsApp.
    return {
      handled: true,
      sub_status: SUPPORT_SUB.CONVERTED,
      startTypebot: true,
      reply: 'Digite *1* para iniciar o atendimento médico pelo WhatsApp.'
    };
  }

  return { handled: false, reply: 'Por favor, responda:\n*1* - Encerrar atendimento\n*2* - Iniciar avaliação para renovação de receita' };
}

async function handleRejectionResponse({ phone, text }) {
  const digits = normalizePhone(phone);
  if (!digits) return { handled: false };

  const rows = await listAtendimentos();
  const match = rows.find((item) => {
    if (String(item.status || '').toLowerCase() !== STATUS.REJECTED) return false;
    if (item.dados_clinicos?.rejection_sub_status !== 'awaiting_response') return false;
    return normalizePhone(item.paciente_telefone) === digits;
  });

  if (!match) return { handled: false };

  const choiceStr = String(text || '').trim();
  const REJECTION_OPTIONS = 'Por favor, responda:\n*1* - Encerrar atendimento\n*2* - Falar com o suporte';

  if (choiceStr === '1') {
    await updateAtendimentoStatus(match.id, STATUS.REJECTED, {
      dados_clinicos: {
        ...(match.dados_clinicos || {}),
        rejection_sub_status: 'closed_by_patient',
        rejection_closed_at: new Date().toISOString()
      }
    });
    await createAuditLog({
      entity_type: 'atendimento', entity_id: match.id,
      action: 'rejection_closed_by_patient', actor: 'n8n',
      payload: { phone: digits.replace(/\d(?=\d{4})/g, '*') }
    });
    try {
      const { sendWhatsAppText } = require('../delivery/delivery.service');
      await sendWhatsAppText({ to: digits, text: 'Atendimento encerrado. Obrigado pelo contato com o Doctor Prescreve! Até logo.' });
    } catch (e) {
      logger.warn('rejection_close_send_failed', { id: match.id, error: e.message });
    }
    return { handled: true, reply: 'Atendimento encerrado. Obrigado pelo contato com o Doctor Prescreve! Até logo.' };
  }

  if (choiceStr === '2') {
    await updateAtendimentoStatus(match.id, STATUS.REJECTED, {
      dados_clinicos: {
        ...(match.dados_clinicos || {}),
        rejection_sub_status: 'converted_to_support',
        rejection_converted_at: new Date().toISOString()
      }
    });
    await createAuditLog({
      entity_type: 'atendimento', entity_id: match.id,
      action: 'rejection_converted_to_support', actor: 'n8n',
      payload: { phone: digits.replace(/\d(?=\d{4})/g, '*') }
    });
    const supportResult = await createWhatsAppSupportEntry({ phone: digits });
    return { handled: true, reply: supportResult.reply, enteredSupport: true };
  }

  return { handled: true, reply: REJECTION_OPTIONS };
}

async function processIncomingMessage({ phone, text }) {
  const err = new Error(
    'processIncomingMessage desativado: use POST /api/whatsapp/webhook (Meta Cloud API) como entrada oficial.'
  );
  err.code = 'LEGACY_SUPPORT_ROUTE_DISABLED';
  err.statusCode = 410;
  throw err;
}

async function closeInactiveSessions() {
  const now = Date.now();
  const rows = await listAtendimentos();
  let closed = 0;

  for (const item of rows) {
    if (!isSupportQueue(item)) continue;
    if (getSupportSubStatus(item) !== SUPPORT_SUB.AWAITING_DECISION) continue;

    const deadline = item.dados_clinicos?.support_decision_deadline;
    const finalizedAt = item.dados_clinicos?.support_finalized_at;
    const isExpired = deadline
      ? now > new Date(deadline).getTime()
      : finalizedAt && (now - new Date(finalizedAt).getTime()) > SUPPORT_TIMEOUT_MS;

    if (!isExpired) continue;

    try {
      await updateAtendimentoStatus(item.id, STATUS.REJECTED, {
        dados_clinicos: {
          ...(item.dados_clinicos || {}),
          support_sub_status: SUPPORT_SUB.INACTIVE,
          support_closed_at: new Date().toISOString(),
          support_closed_by: 'inactivity'
        }
      });
      await createAuditLog({
        entity_type: 'whatsapp_support', entity_id: item.id,
        action: 'support_closed_inactive', actor: 'system',
        payload: { atendimento_id: item.id }
      });
      closed++;
    } catch (e) {
      logger.warn('support_inactivity_close_failed', { id: item.id, error: e.message });
    }
  }

  return closed;
}

module.exports = {
  SUPPORT_SUB,
  SUPPORT_ALREADY_OPEN_REPLY,
  SUPPORT_IN_QUEUE_REPLY,
  SUPPORT_WAITING_REPLY,
  normalizePhone,
  getSupportSubStatus,
  findOpenSupportByPhone,
  findSupportByCreationIdempotencyKey,
  createWhatsAppSupportEntry,
  closeWhatsAppSupportEntry,
  listWhatsAppSupportQueue,
  supportIsOpen,
  startSupportAttendance,
  finalizeSupportAttendance,
  getPatientSupportContext,
  respondToFinalization,
  handleRejectionResponse,
  logSupportInboundMessage,
  processIncomingMessage,
  closeInactiveSessions
};
