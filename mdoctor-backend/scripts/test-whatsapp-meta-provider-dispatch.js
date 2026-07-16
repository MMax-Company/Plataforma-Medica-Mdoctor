#!/usr/bin/env node
/**
 * Testes da integração do provider Meta como provider real selecionável em
 * delivery.service.js (sem ativar em produção — WHATSAPP_PROVIDER é
 * manipulado só dentro deste processo de teste e restaurado ao final).
 *   node mdoctor-backend/scripts/test-whatsapp-meta-provider-dispatch.js
 */
const delivery = require('../src/delivery/delivery.service');
const metaProvider = require('../src/services/providers/meta.provider');

function assert(label, condition) {
  console.log(condition ? `OK  ${label}` : `FAIL ${label}`);
  if (!condition) process.exitCode = 1;
}

const originalProviderEnv = process.env.WHATSAPP_PROVIDER;
const originalMetaSend = metaProvider.sendTextMessage;

function restore() {
  if (originalProviderEnv === undefined) delete process.env.WHATSAPP_PROVIDER;
  else process.env.WHATSAPP_PROVIDER = originalProviderEnv;
  metaProvider.sendTextMessage = originalMetaSend;
}

(async () => {
  // --- resolveWhatsAppProvider reconhece 'meta' sem virar o default ---
  process.env.WHATSAPP_PROVIDER = 'meta';
  assert('resolveWhatsAppProvider reconhece "meta"', delivery.resolveWhatsAppProvider() === 'meta');

  process.env.WHATSAPP_PROVIDER = 'algo-invalido';
  assert('resolveWhatsAppProvider cai para "mock" em valor desconhecido', delivery.resolveWhatsAppProvider() === 'mock');

  delete process.env.WHATSAPP_PROVIDER;
  assert('resolveWhatsAppProvider default é "mock" quando não configurado', delivery.resolveWhatsAppProvider() === 'mock');

  // --- sendWhatsAppText despacha para o provider correto sem tocar rede real ---
  let metaCalled = false;
  metaProvider.sendTextMessage = async () => {
    metaCalled = true;
    return { provider: 'meta', providerMessageId: 'meta-test-id', providerStatus: 'sent' };
  };

  process.env.WHATSAPP_PROVIDER = 'meta';
  const metaResult = await delivery.sendWhatsAppText({ to: '5511999999999', text: 'oi' });
  assert('sendWhatsAppText com WHATSAPP_PROVIDER=meta chama o meta.provider', metaCalled);
  assert('sendWhatsAppText preserva o resultado do meta.provider', metaResult.provider === 'meta');

  metaCalled = false;
  process.env.WHATSAPP_PROVIDER = 'mock';
  let threwNotConfigured = false;
  try {
    await delivery.sendWhatsAppText({ to: '5511999999999', text: 'oi' });
  } catch (e) {
    threwNotConfigured = e.code === 'PROVIDER_NOT_CONFIGURED';
  }
  assert(
    'sendWhatsAppText sem provider real configurado lança PROVIDER_NOT_CONFIGURED sem chamar nenhum provider',
    threwNotConfigured && !metaCalled
  );

  restore();
  console.log('Done.');
})().catch((error) => {
  restore();
  console.error(error);
  process.exit(1);
});
