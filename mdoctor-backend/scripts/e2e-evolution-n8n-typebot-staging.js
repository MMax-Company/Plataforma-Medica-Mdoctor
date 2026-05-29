/**
 * E2E staging: Evolution webhook events -> n8n -> Typebot bridge -> backend (dry-run outbound)
 */

const EVOLUTION_URL =
  process.env.EVOLUTION_API_URL || 'https://evolution-api-staging-staging-40d1.up.railway.app';
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || '';
const N8N_EVO_WEBHOOK =
  process.env.N8N_EVOLUTION_WEBHOOK_URL ||
  'https://n8n-staging-staging-2dfe.up.railway.app/webhook/evolution-webhook';
const N8N_TYPEBOT_WEBHOOK =
  process.env.N8N_WEBHOOK_URL ||
  'https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook';
const BACKEND_URL = process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app';
const INSTANCE = process.env.EVOLUTION_INSTANCE || 'mdoctor-staging';
const CONNECTED_PHONE = '5511926385598';

const ts = Date.now();
const correlationId = `e2e-evo-full-${ts}`;
const idempotencyKey = `e2e-evo-key-${ts}`;

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { response, data };
}

function evolutionHeaders() {
  return { apikey: EVOLUTION_KEY, 'Content-Type': 'application/json' };
}

async function main() {
  const report = { steps: [], phone: CONNECTED_PHONE };

  const health = await requestJson(`${BACKEND_URL}/health`);
  report.steps.push({ name: 'backend_health', ok: health.response.ok, status: health.response.status });

  const readyz = await requestJson(`${BACKEND_URL}/readyz`);
  report.steps.push({ name: 'backend_readyz', ok: readyz.response.ok, status: readyz.response.status });

  const provider = await requestJson(`${BACKEND_URL}/api/whatsapp/provider-status`);
  report.steps.push({
    name: 'provider_status',
    ok: provider.response.ok,
    dryRun: provider.data?.dryRun,
    instanceState: provider.data?.evolution?.instanceState,
    instanceFound: provider.data?.evolution?.instanceFound
  });

  if (EVOLUTION_KEY) {
    const instances = await requestJson(`${EVOLUTION_URL}/instance/fetchInstances`, {
      headers: evolutionHeaders()
    });
    const inst = Array.isArray(instances.data) ? instances.data.find((i) => i.name === INSTANCE) : null;
    report.steps.push({
      name: 'fetchInstances',
      ok: instances.response.ok,
      connectionStatus: inst?.connectionStatus,
      counts: inst?._count
    });

    const state = await requestJson(`${EVOLUTION_URL}/instance/connectionState/${INSTANCE}`, {
      headers: evolutionHeaders()
    });
    report.steps.push({
      name: 'connectionState',
      ok: state.response.ok,
      state: state.data?.instance?.state
    });
  }

  const events = [
    {
      name: 'CONNECTION_UPDATE',
      body: { event: 'CONNECTION_UPDATE', instance: INSTANCE, data: { state: 'open' } }
    },
    {
      name: 'QRCODE_UPDATED',
      body: { event: 'QRCODE_UPDATED', instance: INSTANCE, data: { qrcode: { base64: 'stub' } } }
    },
    {
      name: 'SEND_MESSAGE',
      body: {
        event: 'SEND_MESSAGE',
        instance: INSTANCE,
        data: { key: { remoteJid: `${CONNECTED_PHONE}@s.whatsapp.net`, fromMe: true, id: `send-${ts}` } }
      }
    },
    {
      name: 'MESSAGES_UPDATE',
      body: {
        event: 'MESSAGES_UPDATE',
        instance: INSTANCE,
        data: { key: { remoteJid: `${CONNECTED_PHONE}@s.whatsapp.net`, fromMe: false, id: `upd-${ts}` } }
      }
    },
    {
      name: 'MESSAGES_UPSERT_inbound',
      body: {
        event: 'MESSAGES_UPSERT',
        instance: INSTANCE,
        data: {
          key: { remoteJid: '5511988776655@s.whatsapp.net', fromMe: false, id: idempotencyKey },
          message: {
            conversation:
              'STAGING_E2E_COMPLETE Nome: Teste E2E\nTelefone: 5511988776655\nCPF: 12345678909\nCondicao: hipertensao\nMedicacao: losartana 50mg\nUso continuo: sim\nReceita anterior: sim\nTempo uso: 180 dias\nSinais alerta: NAO\nLGPD: sim\nConsentimento: sim'
          }
        }
      }
    }
  ];

  for (const evt of events) {
    const res = await requestJson(N8N_EVO_WEBHOOK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-Id': `${correlationId}-${evt.name}`,
        'Idempotency-Key': `${idempotencyKey}-${evt.name}`
      },
      body: JSON.stringify(evt.body)
    });
    report.steps.push({
      name: `n8n_evolution_${evt.name}`,
      ok: res.response.ok,
      status: res.response.status,
      route: res.data?.route,
      event: res.data?.event
    });
  }

  const dash = await requestJson(`${BACKEND_URL.replace('mdoctor-backend', 'mdoctor-panel')}/dashboard`.replace(
    'mdoctor-backend-staging-staging.up.railway.app',
    'painel-medico-staging-staging.up.railway.app'
  ));
  report.steps.push({ name: 'panel_dashboard_probe', ok: dash.response.status < 500, status: dash.response.status });

  const failed = report.steps.filter((s) => s.ok === false);
  report.success = failed.length === 0;
  report.correlationId = correlationId;
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.success ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
