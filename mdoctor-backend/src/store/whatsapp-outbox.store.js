const T = require('../db/tables');
const { dbQuery } = require('../db/persistence');

const REJECTION_MESSAGE_KIND = 'clinical_rejection';
const APPROVAL_MESSAGE_KIND = 'clinical_approval';

// Núcleo genérico por trás de findPendingRejectionMessage/findPendingApprovalMessage —
// mesma tabela whatsapp_messages, diferenciadas só pelo message_kind.
async function findPendingMessageByKind(atendimentoId, kind) {
  const data = await dbQuery('buscar mensagem pendente de decisão clínica', (supabase) =>
    supabase
      .from(T.WHATSAPP_MESSAGES)
      .select('*')
      .eq('appointment_id', atendimentoId)
      .eq('direction', 'outbound')
      .eq('metadata->>message_kind', kind)
      .limit(1)
      .maybeSingle()
  );
  return data || null;
}

async function findPendingRejectionMessage(atendimentoId) {
  return findPendingMessageByKind(atendimentoId, REJECTION_MESSAGE_KIND);
}

async function findPendingApprovalMessage(atendimentoId) {
  return findPendingMessageByKind(atendimentoId, APPROVAL_MESSAGE_KIND);
}

// Núcleo genérico por trás de enqueueClinicalRejection/enqueueClinicalApproval.
// Cada kind tem seu próprio índice único (ver migrations) então reprovação e
// aprovação nunca colidem entre si — só duplicam contra elas mesmas.
async function enqueueClinicalMessage({ atendimentoId, phone, message, doctorId, correlationId, kind }) {
  const existing = await findPendingMessageByKind(atendimentoId, kind);
  if (existing) return { message: existing, duplicate: true };

  const idempotencyKey = `${kind === APPROVAL_MESSAGE_KIND ? 'clinical-approve' : 'clinical-reject'}:${atendimentoId}`;
  const row = {
    appointment_id: atendimentoId,
    direction: 'outbound',
    phone,
    body: message,
    status: 'pending',
    metadata: {
      message_kind: kind,
      idempotency_key: idempotencyKey,
      doctor_id: doctorId || null,
      correlation_id: correlationId || null,
      queued_at: new Date().toISOString()
    }
  };

  try {
    const data = await dbQuery('enfileirar mensagem de decisão clínica', (supabase) =>
      supabase.from(T.WHATSAPP_MESSAGES).insert(row).select('*').single()
    );
    return { message: data, duplicate: false };
  } catch (error) {
    if (error?.cause?.code !== '23505') throw error;
    const duplicate = await findPendingMessageByKind(atendimentoId, kind);
    if (!duplicate) throw error;
    return { message: duplicate, duplicate: true };
  }
}

async function enqueueClinicalRejection({ atendimentoId, phone, message, doctorId, correlationId }) {
  return enqueueClinicalMessage({ atendimentoId, phone, message, doctorId, correlationId, kind: REJECTION_MESSAGE_KIND });
}

async function enqueueClinicalApproval({ atendimentoId, phone, message, doctorId, correlationId }) {
  return enqueueClinicalMessage({ atendimentoId, phone, message, doctorId, correlationId, kind: APPROVAL_MESSAGE_KIND });
}

// Idempotência do envio: só a requisição que mover a linha de
// pending/failed para sending pode chamar a Meta; linhas já 'sent' nunca
// voltam a ser reservadas.
async function claimRejectionMessageForSend(messageId) {
  const data = await dbQuery('reservar mensagem de reprovação para envio', (supabase) =>
    supabase
      .from(T.WHATSAPP_MESSAGES)
      .update({ status: 'sending', updated_at: new Date().toISOString() })
      .eq('id', messageId)
      .in('status', ['pending', 'failed'])
      .select('*')
  );
  return Array.isArray(data) && data.length === 1 ? data[0] : null;
}

async function finishRejectionMessage({ messageId, status, providerMessageId = null, errorMessage = null, metadata = {} }) {
  await dbQuery('finalizar mensagem de reprovação', (supabase) =>
    supabase
      .from(T.WHATSAPP_MESSAGES)
      .update({
        status,
        provider_message_id: providerMessageId,
        updated_at: new Date().toISOString(),
        metadata: {
          ...(metadata || {}),
          ...(status === 'sent' ? { sent_at: new Date().toISOString(), send_error: null } : {}),
          ...(errorMessage ? { send_error: String(errorMessage).slice(0, 500) } : {})
        }
      })
      .eq('id', messageId)
  );
}

module.exports = {
  REJECTION_MESSAGE_KIND,
  APPROVAL_MESSAGE_KIND,
  enqueueClinicalRejection,
  enqueueClinicalApproval,
  findPendingRejectionMessage,
  findPendingApprovalMessage,
  claimRejectionMessageForSend,
  finishRejectionMessage
};
