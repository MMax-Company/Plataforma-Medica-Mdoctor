const { STATUS, createAtendimento, listAtendimentos, getAtendimento, updateAtendimentoStatus } = require('../store/atendimentos.store');
const { createAuditLog } = require('../store/audit.store');
const { isSupportQueue, QUEUE_TYPE_SUPPORT } = require('../constants/whatsapp-queue');

function normalizePhone(value = '') {
  return String(value).replace(/\D/g, '').trim();
}

function supportIsOpen(atendimento = {}) {
  const status = String(atendimento.status || '').toLowerCase();
  return status === STATUS.WAITING || status === STATUS.EM_ATENDIMENTO;
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

async function createWhatsAppSupportEntry({ phone, correlationId, idempotencyKey, requestId }) {
  const digits = normalizePhone(phone);
  if (!digits) {
    const error = new Error('telefone obrigatório');
    error.statusCode = 400;
    throw error;
  }

  const existing = await findOpenSupportByPhone(digits);
  if (existing) {
    return { duplicate: true, atendimento: existing, reply: 'Você já está na fila de suporte. Aguarde o contato da equipe.' };
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
    reply:
      'Aguarde, em breve nossa equipe realizará seu atendimento.\n\n*0* - Voltar ao menu inicial\n*ENCERRAR* - Encerrar atendimento'
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
    .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
}

module.exports = {
  normalizePhone,
  findOpenSupportByPhone,
  createWhatsAppSupportEntry,
  closeWhatsAppSupportEntry,
  listWhatsAppSupportQueue,
  supportIsOpen
};
