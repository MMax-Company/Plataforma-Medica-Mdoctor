function trimOrNull(value) {
  const str = value === null || value === undefined ? '' : String(value).trim();
  return str || null;
}

function firstPresentField(obj = {}, fields = []) {
  for (const field of fields) {
    const value = trimOrNull(obj[field]);
    if (value) return value;
  }
  return null;
}

// Campos candidatos para o "parent BSUID" em mensagens INBOUND. A Meta só
// documenta publicamente `recipient_parent_user_id` no lado de statuses
// (outbound) — não há doc/payload real confirmando o campo equivalente em
// mensagens recebidas. `from_parent_user_id`/`contact.parent_user_id` foram
// escolhidos por simetria de nomenclatura, não por especificação oficial.
// NÃO tratar isso como contrato fechado: se a Meta liberar doc ou um payload
// real de contato de interoperabilidade mostrar outro campo, atualizar esta
// lista (é intencionalmente uma lista, não um único nome, para permitir
// adicionar candidatos sem reescrever a lógica de extração).
const PARENT_BSUID_MESSAGE_FIELD_CANDIDATES = ['from_parent_user_id'];
const PARENT_BSUID_CONTACT_FIELD_CANDIDATES = ['parent_user_id'];

// Prioridade de identificação do remetente (payload Meta WhatsApp Cloud API):
//   1. message.from            -> telefone (fluxo clássico)
//   2. message.from_user_id    -> BSUID (interoperabilidade, sem telefone)
//   3. contact.wa_id           -> BSUID (mesmo campo do fluxo clássico, mas
//                                 reaproveitado para o identificador opaco quando
//                                 from/from_user_id estão ausentes)
//   4. contact.user_id         -> BSUID (fallback de menor prioridade)
function extractMetaIdentifiers(message = {}, contact = {}) {
  const phone = trimOrNull(message.from);
  const messageBsuid = trimOrNull(message.from_user_id);
  const contactWaId = trimOrNull(contact.wa_id);
  const contactUserId = trimOrNull(contact.user_id);

  let resolvedPhone = null;
  let resolvedBsuid = null;

  if (phone) {
    resolvedPhone = phone;
  } else if (messageBsuid) {
    resolvedBsuid = messageBsuid;
  } else if (contactWaId) {
    resolvedBsuid = contactWaId;
  } else if (contactUserId) {
    resolvedBsuid = contactUserId;
  }

  const parentBsuid =
    firstPresentField(message, PARENT_BSUID_MESSAGE_FIELD_CANDIDATES) ||
    firstPresentField(contact, PARENT_BSUID_CONTACT_FIELD_CANDIDATES);
  const username = trimOrNull(contact?.profile?.name) || trimOrNull(contact.username);

  return {
    phone: resolvedPhone,
    bsuid: resolvedBsuid,
    parentBsuid,
    // Sempre false: não existe confirmação oficial (doc ou payload real) de
    // qual campo carrega o parent BSUID em mensagens inbound. Consumidores
    // devem tratar `parentBsuid` como best-effort, não como dado validado.
    parentBsuidConfirmed: false,
    username,
    hasIdentifier: Boolean(resolvedPhone || resolvedBsuid)
  };
}

module.exports = {
  PARENT_BSUID_MESSAGE_FIELD_CANDIDATES,
  PARENT_BSUID_CONTACT_FIELD_CANDIDATES,
  extractMetaIdentifiers
};
