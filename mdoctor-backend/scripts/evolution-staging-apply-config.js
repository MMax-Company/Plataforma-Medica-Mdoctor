#!/usr/bin/env node
/**
 * Aplica configuração discreta Evolution staging (API + validação leve).
 * Uso: EVOLUTION_API_URL EVOLUTION_API_KEY EVOLUTION_INSTANCE=DoctorTeste node scripts/evolution-staging-apply-config.js
 */
const base = String(process.env.EVOLUTION_API_URL || 'https://evolution-api-staging-staging-40d1.up.railway.app').replace(
  /\/$/,
  ''
);
const apiKey = String(process.env.EVOLUTION_API_KEY || process.env.AUTHENTICATION_API_KEY || '').trim();
const instance = String(process.env.EVOLUTION_INSTANCE || 'DoctorTeste').trim();
const n8nWebhook =
  process.env.N8N_EVOLUTION_WEBHOOK_URL ||
  'https://n8n-staging-staging-2dfe.up.railway.app/webhook/evolution-webhook';

if (!apiKey) {
  console.error('EVOLUTION_API_KEY ou AUTHENTICATION_API_KEY obrigatório');
  process.exit(1);
}

const headers = { apikey: apiKey, 'Content-Type': 'application/json' };

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  const report = { instance, base, steps: [] };

  const root = await fetch(`${base}/`);
  const rootData = await root.json().catch(() => ({}));
  report.version = rootData.version;

  const settings = await api('POST', `/settings/set/${encodeURIComponent(instance)}`, {
    rejectCall: true,
    msgCall: '',
    groupsIgnore: true,
    alwaysOnline: false,
    readMessages: false,
    readStatus: false,
    syncFullHistory: false,
    wavoipToken: '',
  });
  report.steps.push({ name: 'settings_discrete', ok: settings.ok, status: settings.status });

  const webhook = await api('POST', `/webhook/set/${encodeURIComponent(instance)}`, {
    webhook: {
      enabled: true,
      url: n8nWebhook,
      webhookByEvents: true,
      webhookBase64: false,
      events: ['CONNECTION_UPDATE', 'QRCODE_UPDATED', 'MESSAGES_UPSERT', 'SEND_MESSAGE'],
    },
  });
  report.steps.push({ name: 'webhook_n8n', ok: webhook.ok, webhookByEvents: webhook.data?.webhookByEvents });

  const findWh = await api('GET', `/webhook/find/${encodeURIComponent(instance)}`);
  report.webhook = findWh.data;

  const findSettings = await api('GET', `/settings/find/${encodeURIComponent(instance)}`);
  report.settings = findSettings.data;

  const state = await api('GET', `/instance/connectionState/${encodeURIComponent(instance)}`);
  report.connectionState = state.data?.instance?.state || state.data?.state;

  const n8nProbe = await fetch(`${n8nWebhook}/connection-update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'CONNECTION_UPDATE',
      instance,
      data: { state: 'open' },
    }),
  });
  report.steps.push({ name: 'n8n_webhook_probe', ok: n8nProbe.ok, status: n8nProbe.status });

  console.log(JSON.stringify(report, null, 2));
  const globalByEvents = process.env.WEBHOOK_GLOBAL_WEBHOOK_BY_EVENTS === 'true';
  const ok =
    report.steps.filter((s) => s.name !== 'n8n_webhook_probe').every((s) => s.ok) &&
    report.webhook?.enabled === true &&
    (report.webhook?.webhookByEvents === true || globalByEvents) &&
    report.settings?.syncFullHistory === false;
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
