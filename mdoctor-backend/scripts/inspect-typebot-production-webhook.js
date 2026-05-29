#!/usr/bin/env node
/**
 * Verifica URL do webhook n8n no Typebot produção (API live ou export local).
 *
 * Env: TYPEBOT_API_TOKEN, TYPEBOT_ID (default higij2z0xihxxkr378rmljgu)
 */
require('./load-dotenv');

const fs = require('fs');
const path = require('path');

const PROD_WEBHOOK = 'https://n8n-node-production-f844.up.railway.app/webhook/typebot-webhook';
const PUBLIC_ID = 'doctor-prescreve-8rmljgu';
const typebotId = process.env.TYPEBOT_ID || 'higij2z0xihxxkr378rmljgu';
const exportFile =
  process.env.TYPEBOT_FILE ||
  path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-production.json');
const token = String(process.env.TYPEBOT_API_TOKEN || '').trim();
const baseUrl = String(process.env.TYPEBOT_BASE_URL || 'https://app.typebot.io/api/v1').replace(/\/$/, '');

function extractWebhooksFromTypebot(data = {}) {
  const hits = [];
  const groups = data.groups || data.typebot?.groups || [];
  for (const group of groups) {
    for (const block of group.blocks || []) {
      if (block.type !== 'Webhook') continue;
      const url = block.options?.webhook?.url || '';
      hits.push({
        group: group.title || group.id,
        blockId: block.id,
        url,
        ok: url === PROD_WEBHOOK
      });
    }
  }
  return hits;
}

async function inspectExport() {
  const raw = JSON.parse(fs.readFileSync(path.resolve(exportFile), 'utf8'));
  const hooks = extractWebhooksFromTypebot(raw);
  return {
    source: 'export',
    file: exportFile,
    publicId: raw.publicId,
    webhooks: hooks,
    export_has_prod_url: JSON.stringify(raw).includes(PROD_WEBHOOK),
    export_has_staging_url: JSON.stringify(raw).includes('n8n-staging-staging')
  };
}

async function inspectLive() {
  const res = await fetch(`${baseUrl}/typebots/${typebotId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET typebot -> ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  const tb = data.typebot || data;
  const hooks = extractWebhooksFromTypebot(tb);
  return {
    source: 'api',
    typebotId,
    publicId: tb.publicId,
    isPublished: tb.isPublished,
    name: tb.name,
    webhooks: hooks,
    public_url: tb.publicId ? `https://typebot.co/${tb.publicId}` : null
  };
}

async function main() {
  const report = {
    expected_webhook: PROD_WEBHOOK,
    expected_public_id: PUBLIC_ID,
    export: await inspectExport(),
    live: null,
    ok: false,
    pending: []
  };

  const exportHooks = report.export.webhooks || [];
  const exportOk = exportHooks.some((h) => h.ok) && report.export.export_has_prod_url;
  if (!exportOk) {
    report.pending.push('Export local sem webhook de produção — rodar build-typebot-production-export.js');
  }

  if (token) {
    try {
      report.live = await inspectLive();
      const liveOk = (report.live.webhooks || []).some((h) => h.ok);
      report.ok = exportOk && liveOk;
      if (!liveOk) {
        report.pending.push('Bot publicado na API não aponta para n8n produção — rodar publish-typebot-production.js');
      }
      if (report.live.publicId && report.live.publicId !== PUBLIC_ID) {
        report.pending.push(`publicId divergente: esperado ${PUBLIC_ID}, atual ${report.live.publicId}`);
      }
    } catch (e) {
      report.live = { error: e.message };
      report.pending.push('Falha ao consultar API Typebot — conferir TYPEBOT_API_TOKEN');
      report.ok = false;
    }
  } else {
    report.pending.push('TYPEBOT_API_TOKEN ausente — inspeção apenas do export; publicar com publish-typebot-production.js');
    report.ok = exportOk;
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
