/**
 * Publica Typebot produção (bot existente doctor-prescreve-8rmljgu).
 * Usa export reorganizado com webhook n8n produção.
 *
 * Env:
 *   TYPEBOT_API_TOKEN (obrigatório)
 *   TYPEBOT_FILE (default docs/typebot/typebot-doctor-prescreve-production.json)
 */

require('./load-dotenv');
const fs = require('fs');
const path = require('path');

const baseUrl = String(process.env.TYPEBOT_BASE_URL || 'https://app.typebot.io/api/v1').replace(/\/$/, '');
const token = String(process.env.TYPEBOT_API_TOKEN || '').trim();
const typebotId = String(process.env.TYPEBOT_ID || 'higij2z0xihxxkr378rmljgu').trim();
const typebotFile =
  process.env.TYPEBOT_FILE ||
  path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-production.json');

const PROD_WEBHOOK = 'https://n8n-node-production-f844.up.railway.app/webhook/typebot-webhook';

if (!token) {
  console.error('TYPEBOT_API_TOKEN is required');
  process.exit(1);
}

if (!fs.existsSync(path.resolve(typebotFile))) {
  console.error(`Missing ${typebotFile} — run: node mdoctor-backend/scripts/build-typebot-production-export.js`);
  process.exit(1);
}

const exportJson = JSON.parse(fs.readFileSync(path.resolve(typebotFile), 'utf8'));

function buildPatchBody(data) {
  return {
    typebot: {
      version: data.version || '6.1',
      name: data.name || 'Doctor Prescreve',
      icon: data.icon ?? null,
      selectedThemeTemplateId: data.selectedThemeTemplateId ?? null,
      groups: data.groups,
      edges: data.edges,
      variables: data.variables,
      events: data.events,
      theme: data.theme || {},
      settings: data.settings || { general: { isBrandingEnabled: true } }
    }
  };
}

async function request(method, urlPath, body) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${method} ${urlPath} -> ${response.status}: ${text.slice(0, 500)}`);
  }
  return data;
}

async function main() {
  const serialized = JSON.stringify(exportJson);
  if (!serialized.includes(PROD_WEBHOOK)) {
    throw new Error(`Export must contain production webhook ${PROD_WEBHOOK}`);
  }
  if (serialized.includes('n8n-staging-staging')) {
    throw new Error('Export contains staging n8n URL — aborting');
  }

  const report = { typebotId, publicId: exportJson.publicId, file: typebotFile, steps: [] };

  const current = await request('GET', `/typebots/${typebotId}`);
  report.steps.push({ step: 'get', publicId: current?.typebot?.publicId, published: current?.typebot?.isPublished });

  const patched = await request('PATCH', `/typebots/${typebotId}`, buildPatchBody(exportJson));
  report.steps.push({
    step: 'patch',
    name: patched?.typebot?.name,
    groups: patched?.typebot?.groups?.length
  });

  try {
    const published = await request('POST', `/typebots/${typebotId}/publish`);
    report.steps.push({ step: 'publish', published: published?.typebot?.isPublished ?? true });
  } catch (publishError) {
    report.steps.push({
      step: 'publish',
      failed: true,
      message: publishError.message,
      hint: 'PATCH applied; publish may require Typebot paid plan (file upload block)'
    });
  }

  const verify = await request('GET', `/typebots/${typebotId}`);
  report.steps.push({
    step: 'verify',
    publicId: verify?.typebot?.publicId,
    isPublished: verify?.typebot?.isPublished,
    name: verify?.typebot?.name
  });

  console.log(JSON.stringify({ success: true, webhook: PROD_WEBHOOK, ...report }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
