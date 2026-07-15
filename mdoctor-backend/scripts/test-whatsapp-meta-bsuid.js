#!/usr/bin/env node
/**
 * Testes de suporte a BSUID na integração Meta WhatsApp (identificação de
 * contatos sem telefone + provider de envio).
 *   node mdoctor-backend/scripts/test-whatsapp-meta-bsuid.js
 *   BACKEND_URL=... node mdoctor-backend/scripts/test-whatsapp-meta-bsuid.js --http
 */
const { extractMetaIdentifiers, extractStatusErrors } = require('../src/services/whatsapp-meta-identity.service');
const { resolveRecipient } = require('../src/services/providers/meta.provider');

function assert(label, condition) {
  console.log(condition ? `OK  ${label}` : `FAIL ${label}`);
  if (!condition) process.exitCode = 1;
}

// --- extractMetaIdentifiers: prioridade message.from > message.from_user_id > contact.wa_id > contact.user_id ---

let identity = extractMetaIdentifiers({ from: '5511999999999' }, {});
assert('message.from presente -> telefone', identity.phone === '5511999999999' && !identity.bsuid);

identity = extractMetaIdentifiers({ from_user_id: 'bsuid-msg-123' }, {});
assert('sem from, com from_user_id -> BSUID', identity.bsuid === 'bsuid-msg-123' && !identity.phone);

identity = extractMetaIdentifiers({}, { wa_id: 'bsuid-contact-wa' });
assert('sem from/from_user_id, com contact.wa_id -> BSUID', identity.bsuid === 'bsuid-contact-wa' && !identity.phone);

identity = extractMetaIdentifiers({}, { user_id: 'bsuid-contact-user' });
assert('só contact.user_id -> BSUID (menor prioridade)', identity.bsuid === 'bsuid-contact-user');

identity = extractMetaIdentifiers(
  { from: '5511888888888', from_user_id: 'bsuid-msg' },
  { wa_id: 'bsuid-contact' }
);
assert('from vence mesmo com from_user_id e contact presentes', identity.phone === '5511888888888' && !identity.bsuid);

identity = extractMetaIdentifiers({}, {});
assert('mensagem sem nenhum identificador não derruba o processo', identity.hasIdentifier === false);

identity = extractMetaIdentifiers(
  { from_user_id: 'bsuid-1', from_parent_user_id: 'parent-bsuid-1' },
  { profile: { name: 'Paciente Teste' } }
);
assert('parentBsuid extraído de from_parent_user_id', identity.parentBsuid === 'parent-bsuid-1');
assert('username extraído de contact.profile.name', identity.username === 'Paciente Teste');
assert(
  'parentBsuidConfirmed é sempre false (inferência não documentada, não é contrato oficial)',
  identity.parentBsuidConfirmed === false
);

identity = extractMetaIdentifiers({ from: '5511999999999' }, {});
assert('parentBsuidConfirmed false mesmo sem parentBsuid resolvido', identity.parentBsuidConfirmed === false);

// --- extractStatusErrors: log seguro de status "failed" (só code/title/details) ---

let statusErrors = extractStatusErrors({ status: 'sent' });
assert('status sem errors[] retorna array vazio', Array.isArray(statusErrors) && statusErrors.length === 0);

statusErrors = extractStatusErrors({
  status: 'failed',
  errors: [
    {
      code: 131047,
      title: 'Re-engagement message',
      message: 'Message failed to send because more than 24 hours have passed since the customer last replied to this number.',
      error_data: { details: 'Message failed to send because more than 24 hours have passed since the customer last replied to this number.' },
      href: 'https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/'
    }
  ]
});
assert('status failed extrai code', statusErrors[0].code === 131047);
assert('status failed extrai title', statusErrors[0].title === 'Re-engagement message');
assert('status failed extrai error_data.details', statusErrors[0].details.includes('24 hours'));
assert('status failed NÃO inclui campos fora de code/title/details (ex: href)', !('href' in statusErrors[0]) && !('message' in statusErrors[0]));

statusErrors = extractStatusErrors({
  status: 'failed',
  errors: [{ code: 470 }, { code: 471, title: 'Segundo erro' }]
});
assert('múltiplos errors[] são todos mapeados', statusErrors.length === 2 && statusErrors[1].title === 'Segundo erro');

statusErrors = extractStatusErrors({ status: 'failed', errors: [{ code: 999 }] });
assert('error sem error_data.details não quebra (vira null)', statusErrors[0].details === null);

// --- meta.provider.resolveRecipient: telefone usa "to", BSUID usa "recipient" ---

const byPhone = resolveRecipient({ to: '5511999999999' });
assert('resolveRecipient telefone usa "to"', byPhone.to === '5511999999999' && !byPhone.recipient);

const byBsuid = resolveRecipient({ bsuid: 'bsuid-abc' });
assert('resolveRecipient BSUID usa "recipient"', byBsuid.recipient?.id === 'bsuid-abc' && !byBsuid.to);

let threw = false;
try {
  resolveRecipient({});
} catch (e) {
  threw = e.code === 'META_MISSING_RECIPIENT';
}
assert('resolveRecipient sem telefone nem BSUID lança erro claro', threw);

// --- Probe HTTP opcional: webhook Meta contendo SOMENTE BSUID, sem nenhum número ---

async function httpProbe() {
  const base = String(process.env.BACKEND_URL || 'http://127.0.0.1:3004').replace(/\/$/, '');

  const health = await fetch(`${base}/healthz`);
  assert('http healthz', health.ok);

  const bsuidOnlyPayload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-test',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              contacts: [{ profile: { name: 'Contato BSUID' }, wa_id: 'bsuid-only-contact-999' }],
              messages: [
                {
                  id: `wamid.test-bsuid-${Date.now()}`,
                  from_user_id: 'bsuid-only-999',
                  from_parent_user_id: 'bsuid-parent-999',
                  type: 'text',
                  text: { body: '1' }
                }
              ]
            }
          }
        ]
      }
    ]
  };

  const res = await fetch(`${base}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bsuidOnlyPayload)
  });
  const body = await res.text();
  console.log('HTTP', res.status, body);
  assert('webhook aceita payload só-BSUID (sem telefone em lugar algum) com 200', res.status === 200 && body === 'EVENT_RECEIVED');
}

(async () => {
  if (process.argv.includes('--http')) {
    await httpProbe();
  }
  console.log('Done.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
