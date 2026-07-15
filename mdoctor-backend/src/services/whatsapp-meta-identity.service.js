function trimOrNull(value) {
  const str = value === null || value === undefined ? '' : String(value).trim();
  return str || null;
}

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

  const parentBsuid = trimOrNull(message.from_parent_user_id) || trimOrNull(contact.parent_user_id);
  const username = trimOrNull(contact?.profile?.name) || trimOrNull(contact.username);

  return {
    phone: resolvedPhone,
    bsuid: resolvedBsuid,
    parentBsuid,
    username,
    hasIdentifier: Boolean(resolvedPhone || resolvedBsuid)
  };
}

module.exports = {
  extractMetaIdentifiers
};
