const T = require('../db/tables');
const { dbQuery } = require('../db/persistence');

const REJECTION_MESSAGE_KIND = 'clinical_rejection';

async function findPendingRejectionMessage(atendimentoId) {
  const data = await dbQuery('buscar mensagem pendente de reprovação', (supabase) =>
    supabase
      .from(T.WHATSAPP_MESSAGES)
      .select('*')
      .eq('appointment_id', atendimentoId)
      .eq('direction', 'outbound')
      .eq('metadata->>message_kind', REJECTION_MESSAGE_KIND)
      .limit(1)
      .maybeSingle()
  );
  return data || null;
}

async function enqueueClinicalRejection({ atendimentoId, phone, message, doctorId, correlationId }) {
  const existing = await findPendingRejectionMessage(atendimentoId);
  if (existing) return { message: existing, duplicate: true };

  const idempotencyKey = `clinical-reject:${atendimentoId}`;
  const row = {
    appointment_id: atendimentoId,
    direction: 'outbound',
    phone,
    body: message,
    status: 'pending',
    metadata: {
      message_kind: REJECTION_MESSAGE_KIND,
      idempotency_key: idempotencyKey,
      doctor_id: doctorId || null,
      correlation_id: correlationId || null,
      queued_at: new Date().toISOString()
    }
  };

  try {
    const data = await dbQuery('enfileirar mensagem de reprovação', (supabase) =>
      supabase.from(T.WHATSAPP_MESSAGES).insert(row).select('*').single()
    );
    return { message: data, duplicate: false };
  } catch (error) {
    if (error?.cause?.code !== '23505') throw error;
    const duplicate = await findPendingRejectionMessage(atendimentoId);
    if (!duplicate) throw error;
    return { message: duplicate, duplicate: true };
  }
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
  enqueueClinicalRejection,
  findPendingRejectionMessage,
  claimRejectionMessageForSend,
  finishRejectionMessage
};
