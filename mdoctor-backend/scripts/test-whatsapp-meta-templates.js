#!/usr/bin/env node
/**
 * Testes da capacidade mínima de list + manage de templates da WABA
 * (whatsapp_business_management). Usa fetch mockado — nenhuma chamada de
 * rede real é feita, nada é ativado em produção.
 *   node mdoctor-backend/scripts/test-whatsapp-meta-templates.js
 */
process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = 'phone-test-456';
process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = 'waba-test-123';

const metaProvider = require('../src/services/providers/meta.provider');

function assert(label, condition) {
  console.log(condition ? `OK  ${label}` : `FAIL ${label}`);
  if (!condition) process.exitCode = 1;
}

const originalFetch = global.fetch;
let lastCall = null;

function mockFetch(status, body) {
  global.fetch = async (url, options = {}) => {
    lastCall = { url, options };
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body)
    };
  };
}

function restore() {
  global.fetch = originalFetch;
}

(async () => {
  assert('isTemplatesConfigured true com token + WABA ID presentes', metaProvider.isTemplatesConfigured() === true);

  mockFetch(200, { data: [{ name: 'tpl_a', status: 'APPROVED' }], paging: {} });
  const listResult = await metaProvider.listMessageTemplates({ limit: 5 });
  assert('listMessageTemplates chama o endpoint da WABA correta', lastCall.url.includes('/waba-test-123/message_templates'));
  assert('listMessageTemplates usa GET', (lastCall.options.method || 'GET') === 'GET');
  assert(
    'listMessageTemplates retorna os templates parseados',
    listResult.templates.length === 1 && listResult.templates[0].name === 'tpl_a'
  );
  assert('DEFAULT_API_VERSION é v25.0 (sem WHATSAPP_GRAPH_API_VERSION setado)', lastCall.url.startsWith('https://graph.facebook.com/v25.0/'));

  process.env.WHATSAPP_GRAPH_API_VERSION = 'v30.0';
  mockFetch(200, { data: [], paging: {} });
  await metaProvider.listMessageTemplates();
  assert('WHATSAPP_GRAPH_API_VERSION continua funcionando como override', lastCall.url.startsWith('https://graph.facebook.com/v30.0/'));
  delete process.env.WHATSAPP_GRAPH_API_VERSION;

  mockFetch(200, { id: 'tpl-id-1', status: 'PENDING', category: 'UTILITY' });
  const createResult = await metaProvider.createMessageTemplate({
    name: 'tpl_demo',
    category: 'UTILITY',
    language: 'pt_BR',
    components: [{ type: 'BODY', text: 'Olá {{1}}' }]
  });
  assert('createMessageTemplate usa POST', lastCall.options.method === 'POST');
  assert(
    'createMessageTemplate envia name/category/language/components no body',
    (() => {
      const body = JSON.parse(lastCall.options.body);
      return (
        body.name === 'tpl_demo' &&
        body.category === 'UTILITY' &&
        body.language === 'pt_BR' &&
        Array.isArray(body.components)
      );
    })()
  );
  assert('createMessageTemplate retorna status PENDING (submissão para aprovação)', createResult.status === 'PENDING');

  lastCall = null;
  let threwInvalidPayload = false;
  try {
    await metaProvider.createMessageTemplate({ name: 'x', category: 'UTILITY', language: 'pt_BR' });
  } catch (e) {
    threwInvalidPayload = e.code === 'INVALID_TEMPLATE_PAYLOAD';
  }
  assert('createMessageTemplate sem components lança INVALID_TEMPLATE_PAYLOAD sem chamar a API', threwInvalidPayload && lastCall === null);

  mockFetch(200, { success: true });
  const deleteResult = await metaProvider.deleteMessageTemplate({ name: 'tpl_demo' });
  assert('deleteMessageTemplate usa DELETE', lastCall.options.method === 'DELETE');
  assert('deleteMessageTemplate inclui o nome do template na query string', lastCall.url.includes('name=tpl_demo'));
  assert('deleteMessageTemplate retorna success true', deleteResult.success === true);

  delete process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  let threwNotConfigured = false;
  try {
    await metaProvider.listMessageTemplates();
  } catch (e) {
    threwNotConfigured = e.code === 'PROVIDER_NOT_CONFIGURED';
  }
  assert('sem WHATSAPP_BUSINESS_ACCOUNT_ID, listMessageTemplates lança PROVIDER_NOT_CONFIGURED', threwNotConfigured);

  restore();
  console.log('Done.');
})().catch((error) => {
  restore();
  console.error(error);
  process.exit(1);
});
