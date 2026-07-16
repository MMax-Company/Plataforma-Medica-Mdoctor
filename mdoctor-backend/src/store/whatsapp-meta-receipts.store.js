const { requireSupabaseClient, throwOnDbError } = require('../db/persistence');

const TABLE = 'whatsapp_meta_message_receipts';

async function claimMetaMessage({ messageId, whatsappSessionId }) {
  const supabase = requireSupabaseClient('deduplicar mensagem Meta');
  const result = await supabase
    .from(TABLE)
    .upsert(
      { meta_message_id: messageId, whatsapp_session_id: whatsappSessionId || null, status: 'processing' },
      { onConflict: 'meta_message_id', ignoreDuplicates: true }
    )
    .select('meta_message_id');
  throwOnDbError(result.error, 'deduplicar mensagem Meta');
  return { claimed: Array.isArray(result.data) && result.data.length === 1 };
}

async function finishMetaMessage({ messageId, status, providerMessageIds = [], errorMessage = null }) {
  const supabase = requireSupabaseClient('finalizar mensagem Meta');
  const result = await supabase
    .from(TABLE)
    .update({
      status,
      provider_message_ids: providerMessageIds,
      error_message: errorMessage ? String(errorMessage).slice(0, 2000) : null,
      updated_at: new Date().toISOString()
    })
    .eq('meta_message_id', messageId);
  throwOnDbError(result.error, 'finalizar mensagem Meta');
}

module.exports = { claimMetaMessage, finishMetaMessage };

