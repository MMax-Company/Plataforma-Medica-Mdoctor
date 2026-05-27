function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function normalizeWhatsAppPayload(body = {}) {
  const from = firstValue(
    body.from,
    body.From,
    body.phone,
    body.telefone,
    body.sender,
    body.remoteJid,
    body?.message?.from,
    body?.body?.from
  );

  const text = firstValue(
    body.text,
    body.Body,
    body.message,
    body.mensagem,
    body.content,
    body?.message?.text,
    body?.body?.text
  );

  return {
    from: typeof from === 'string' ? from.trim() : from,
    text: typeof text === 'string' ? text.trim() : text || '',
    rawMessage: body.rawMessage || body
  };
}

function legacyFilaResponse(data = {}) {
  const atendimentos = Array.isArray(data.atendimentos) ? data.atendimentos : [];
  return {
    success: data.success !== false,
    total: atendimentos.length,
    fila: atendimentos,
    atendimentos
  };
}

module.exports = {
  firstValue,
  legacyFilaResponse,
  normalizeWhatsAppPayload
};
