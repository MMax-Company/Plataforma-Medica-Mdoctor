// Teste isolado (sem rede) do alerta administrativo WhatsApp via template
// Utility. Verifica: usa sendTemplateMessage por padrão; cai no texto livre
// se o template falhar; Telegram inalterado; isolamento total.
const assert = require('assert');
const path = require('path');

function stub(fromFile, relativePath, exports) {
  const resolved = require.resolve(path.join(path.dirname(fromFile), relativePath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const svcPath = require.resolve('../src/services/admin-alert.service.js');

process.env.ADMIN_ALERT_PHONE = '11926260111';

let templateCalls = [];
let textCalls = [];
let telegramCalls = [];
let templateShouldThrow = false;

stub(svcPath, './providers/meta.provider', {
  sendTemplateMessage: async (p) => {
    templateCalls.push(p);
    if (templateShouldThrow) throw Object.assign(new Error('template PAUSED'), { code: 'TEMPLATE_PAUSED' });
    return { providerMessageId: 'wamid.tpl', providerStatus: 'sent' };
  },
  sendTextMessage: async (p) => { textCalls.push(p); return { providerMessageId: 'wamid.txt' }; }
});
stub(svcPath, './providers/telegram.provider', {
  isConfigured: () => true,
  sendTextMessage: async (p) => { telegramCalls.push(p); return { ok: true }; }
});
stub(svcPath, '../config/logger', { info: () => {}, warn: () => {}, error: () => {} });

delete require.cache[svcPath];
const { notifyAdminAlert } = require('../src/services/admin-alert.service.js');

function reset() { templateCalls = []; textCalls = []; telegramCalls = []; templateShouldThrow = false; }

async function main() {
  const results = {};

  // 1) caminho feliz: usa template, NÃO usa texto livre
  reset();
  let out = await notifyAdminAlert({ type: 'medical_queue', id: 'ae6d267b-5a22-4da7-811b-562a6e235b24' });
  assert.equal(templateCalls.length, 1, 'usa sendTemplateMessage');
  assert.equal(templateCalls[0].name, 'doctor_admin_alerta_fila_medica_v1');
  assert.equal(templateCalls[0].languageCode, 'pt_BR');
  assert.deepEqual(templateCalls[0].bodyParameters, ['235B24'], 'shortId como {{1}}');
  assert.equal(textCalls.length, 0, 'não manda texto livre quando o template vai');
  assert.equal(telegramCalls.length, 1, 'Telegram sempre em paralelo');
  assert.equal(out.whatsapp, 'sent');
  assert.equal(out.telegram, 'sent');
  results.template_primario_semTextoLivre = 'ok';

  // 2) mapeamento dos 3 tipos
  reset();
  await notifyAdminAlert({ type: 'support_queue', id: 'x'.repeat(6) });
  await notifyAdminAlert({ type: 'medical_support_queue', id: 'y'.repeat(6) });
  assert.equal(templateCalls[0].name, 'doctor_admin_alerta_suporte_v1');
  assert.equal(templateCalls[1].name, 'doctor_admin_alerta_suporte_medico_v1');
  results.mapeamento_3_tipos = 'ok';

  // 3) template falha -> fallback texto livre; ainda retorna 'sent'
  reset();
  templateShouldThrow = true;
  out = await notifyAdminAlert({ type: 'medical_queue', id: 'abc123def456' });
  assert.equal(templateCalls.length, 1, 'tentou o template');
  assert.equal(textCalls.length, 1, 'caiu no texto livre');
  assert.ok(/ALERTA MÉDICO/.test(textCalls[0].text));
  assert.equal(out.whatsapp, 'sent');
  results.templateFalha_fallbackTextoLivre = 'ok';

  // 4) tipo desconhecido -> skipped, nada enviado
  reset();
  out = await notifyAdminAlert({ type: 'tipo_inexistente', id: 'zzz999' });
  assert.equal(templateCalls.length, 0);
  assert.equal(textCalls.length, 0);
  assert.equal(out.whatsapp, 'skipped');
  results.tipoDesconhecido_skipped = 'ok';

  // 5) sem ADMIN_ALERT_PHONE -> whatsapp skipped, Telegram ainda vai
  reset();
  const prev = process.env.ADMIN_ALERT_PHONE;
  delete process.env.ADMIN_ALERT_PHONE;
  out = await notifyAdminAlert({ type: 'medical_queue', id: 'noPhone123' });
  process.env.ADMIN_ALERT_PHONE = prev;
  assert.equal(out.whatsapp, 'skipped');
  assert.equal(templateCalls.length, 0);
  assert.equal(telegramCalls.length, 1);
  results.semAdminPhone_whatsappSkipped = 'ok';

  console.log(JSON.stringify(results, null, 2));
  const falhas = Object.entries(results).filter(([, v]) => v !== 'ok');
  if (falhas.length) { console.error('FALHAS:', falhas); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
