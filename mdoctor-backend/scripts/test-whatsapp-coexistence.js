#!/usr/bin/env node
/**
 * Testes do mínimo funcional de WhatsApp Business App Coexistence
 * (Embedded Signup v4): troca de code, smb_app_data, e webhooks oficiais
 * (account_update/history/smb_app_state_sync/smb_message_echoes) via mocks —
 * nenhuma chamada real à Meta, nenhum onboarding disparado.
 *   node mdoctor-backend/scripts/test-whatsapp-coexistence.js
 *   BACKEND_URL=... node mdoctor-backend/scripts/test-whatsapp-coexistence.js --http
 */
process.env.WHATSAPP_APP_ID = 'test-app-id';
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = 'phone-test-456';

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
  assert('isCoexistenceExchangeConfigured true com app id + secret', metaProvider.isCoexistenceExchangeConfigured() === true);

  // --- exchangeEmbeddedSignupCode ---

  mockFetch(200, { access_token: 'super-secret-should-never-leak', token_type: 'bearer', expires_in: 5184000 });
  const exchangeResult = await metaProvider.exchangeEmbeddedSignupCode({ code: 'auth-code-123' });
  assert('exchangeEmbeddedSignupCode chama GET /oauth/access_token', lastCall.url.includes('/oauth/access_token'));
  assert('exchangeEmbeddedSignupCode envia client_id/client_secret/code', (() => {
    const url = new URL(lastCall.url);
    return url.searchParams.get('client_id') === 'test-app-id' &&
      url.searchParams.get('client_secret') === 'test-app-secret' &&
      url.searchParams.get('code') === 'auth-code-123';
  })());
  assert('exchangeEmbeddedSignupCode retorna exchanged=true', exchangeResult.exchanged === true);
  assert('exchangeEmbeddedSignupCode NUNCA retorna o access_token bruto', !('access_token' in exchangeResult) && !JSON.stringify(exchangeResult).includes('super-secret-should-never-leak'));

  lastCall = null;
  let threwNoCode = false;
  try {
    await metaProvider.exchangeEmbeddedSignupCode({});
  } catch (e) {
    threwNoCode = e.code === 'INVALID_EXCHANGE_PAYLOAD';
  }
  assert('exchangeEmbeddedSignupCode sem code lança INVALID_EXCHANGE_PAYLOAD sem chamar a API', threwNoCode && lastCall === null);

  const savedAppSecret = process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_APP_SECRET;
  let threwNotConfigured = false;
  try {
    await metaProvider.exchangeEmbeddedSignupCode({ code: 'x' });
  } catch (e) {
    threwNotConfigured = e.code === 'PROVIDER_NOT_CONFIGURED';
  }
  assert('exchangeEmbeddedSignupCode sem WHATSAPP_APP_SECRET lança PROVIDER_NOT_CONFIGURED', threwNotConfigured && lastCall === null);
  process.env.WHATSAPP_APP_SECRET = savedAppSecret;

  // --- syncSmbAppState / syncSmbAppHistory ---

  mockFetch(200, { success: true });
  const stateResult = await metaProvider.syncSmbAppState({ phoneNumberId: '1117281621479089' });
  assert('syncSmbAppState chama POST /{phoneNumberId}/smb_app_data', lastCall.url.includes('/1117281621479089/smb_app_data') && lastCall.options.method === 'POST');
  assert('syncSmbAppState envia sync_type=smb_app_state_sync', JSON.parse(lastCall.options.body).sync_type === 'smb_app_state_sync');
  assert('syncSmbAppState retorna success true', stateResult.success === true);

  mockFetch(200, { success: true });
  await metaProvider.syncSmbAppHistory({ phoneNumberId: '1117281621479089' });
  assert('syncSmbAppHistory envia sync_type=history', JSON.parse(lastCall.options.body).sync_type === 'history');

  lastCall = null;
  let threwNoPhoneId = false;
  try {
    await metaProvider.syncSmbAppState({});
  } catch (e) {
    threwNoPhoneId = e.code === 'INVALID_SMB_APP_DATA_PAYLOAD';
  }
  assert('syncSmbAppState sem phoneNumberId lança INVALID_SMB_APP_DATA_PAYLOAD sem chamar a API', threwNoPhoneId && lastCall === null);

  restore();

  // --- Probe HTTP opcional: webhooks oficiais de Coexistence (mocks, sem tocar a Meta de verdade) ---

  async function httpProbe() {
    const base = String(process.env.BACKEND_URL || 'http://127.0.0.1:3004').replace(/\/$/, '');

    const health = await fetch(`${base}/healthz`);
    assert('http healthz', health.ok);

    async function postCoexistenceWebhook(field, value) {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [{ id: 'waba-test', changes: [{ field, value }] }]
      };
      const res = await fetch(`${base}/api/whatsapp/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = await res.text();
      return { status: res.status, body };
    }

    let result = await postCoexistenceWebhook('account_update', {
      event: 'PARTNER_REMOVED',
      disconnection_info: { reason: 'user_initiated', initiated_by: 'USER' }
    });
    assert('webhook account_update aceito com 200 (mock)', result.status === 200 && result.body === 'EVENT_RECEIVED');

    result = await postCoexistenceWebhook('history', { metadata: { phase: 0 }, history: [{ mock: true }] });
    assert('webhook history aceito com 200 (mock, sem sincronizar)', result.status === 200 && result.body === 'EVENT_RECEIVED');

    result = await postCoexistenceWebhook('smb_app_state_sync', { state_sync: [{ mock: true }] });
    assert('webhook smb_app_state_sync aceito com 200 (mock, sem sincronizar)', result.status === 200 && result.body === 'EVENT_RECEIVED');

    result = await postCoexistenceWebhook('smb_message_echoes', { message_echoes: [{ mock: true }] });
    assert('webhook smb_message_echoes aceito com 200 (mock, sem sincronizar)', result.status === 200 && result.body === 'EVENT_RECEIVED');

    const configRes = await fetch(`${base}/api/admin/whatsapp/coexistence/config`);
    const config = await configRes.json();
    assert('GET /api/admin/whatsapp/coexistence/config responde 200', configRes.status === 200 && config.success === true);
    console.log('config atual do backend:', JSON.stringify({
      embeddedSignupConfigured: config.embeddedSignupConfigured,
      coexistenceExchangeConfigured: config.coexistenceExchangeConfigured,
      configuredParts: config.configuredParts
    }));

    // Regressão: CSP global (helmet, script-src 'self' sem exceções) travava
    // a página em "Carregando configuração…" porque bloqueava o <script>
    // inline e o SDK externo da Meta. Confirma que a rota da página sobrescreve
    // o CSP para permitir script-src 'self' + connect.facebook.net, e que o
    // JS externo é servido corretamente.
    const signupRes = await fetch(`${base}/api/admin/whatsapp/coexistence/signup`);
    const signupCsp = signupRes.headers.get('content-security-policy') || '';
    assert('GET /coexistence/signup responde 200', signupRes.status === 200);
    assert(
      'CSP da página de signup permite script-src self + connect.facebook.net (não é o CSP global default)',
      signupCsp.includes("script-src 'self' https://connect.facebook.net")
    );
    const signupHtml = await signupRes.text();
    assert('página não tem mais <script> inline (JS extraído para arquivo externo)', !/<script>[\s\S]*fetch\(/.test(signupHtml));
    assert('página referencia o JS externo same-origin', signupHtml.includes('src="/api/admin/whatsapp/coexistence/signup.js"'));

    const signupJsRes = await fetch(`${base}/api/admin/whatsapp/coexistence/signup.js`);
    assert('GET /coexistence/signup.js responde 200', signupJsRes.status === 200);
    assert(
      'GET /coexistence/signup.js é servido como JavaScript',
      (signupJsRes.headers.get('content-type') || '').includes('javascript')
    );
    const signupJsBody = await signupJsRes.text();
    assert('signup.js contém loadConfig()', signupJsBody.includes('function loadConfig'));
  }

  if (process.argv.includes('--http')) {
    await httpProbe();
  }
  console.log('Done.');
})().catch((error) => {
  restore();
  console.error(error);
  process.exit(1);
});
