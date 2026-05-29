/**
 * Atualiza e publica o Typebot staging (bot existente — não cria bot novo).
 *
 * Env:
 *   TYPEBOT_API_TOKEN (obrigatório)
 *   TYPEBOT_BASE_URL (default https://app.typebot.io/api/v1)
 *   TYPEBOT_ID (default higij2z0xihxxkr378rmljgu)
 *   TYPEBOT_FILE (default docs/typebot/typebot-doctor-prescreve-staging-safe.json)
 */

const fs = require('fs');
const path = require('path');

const baseUrl = String(process.env.TYPEBOT_BASE_URL || 'https://app.typebot.io/api/v1').replace(/\/$/, '');
const token = String(process.env.TYPEBOT_API_TOKEN || '').trim();
const typebotId = String(process.env.TYPEBOT_ID || 'higij2z0xihxxkr378rmljgu').trim();
const typebotFile =
  process.env.TYPEBOT_FILE ||
  path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-staging-safe.json');

if (!token) {
  console.error('TYPEBOT_API_TOKEN is required');
  process.exit(1);
}

const exportJson = JSON.parse(fs.readFileSync(path.resolve(typebotFile), 'utf8'));

function buildPatchBody(data) {
  return {
    typebot: {
      version: data.version || '6.1',
      name: data.name || 'Doctor Prescreve - Staging Safe',
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
  const report = { typebotId, file: typebotFile, steps: [] };

  const current = await request('GET', `/typebots/${typebotId}`);
  report.steps.push({ step: 'get', publicId: current?.typebot?.publicId || exportJson.publicId });

  const patched = await request('PATCH', `/typebots/${typebotId}`, buildPatchBody(exportJson));
  report.steps.push({
    step: 'patch',
    name: patched?.typebot?.name,
    groups: patched?.typebot?.groups?.length,
    variables: patched?.typebot?.variables?.length
  });

  const published = await request('POST', `/typebots/${typebotId}/publish`, {});
  report.steps.push({
    step: 'publish',
    publishedAt: published?.publishedTypebot?.createdAt || published?.typebot?.updatedAt || 'ok'
  });

  console.log(JSON.stringify({ success: true, ...report }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
  process.exit(1);
});
