#!/usr/bin/env node
/**
 * Valida o token Meta WhatsApp após configurar WHATSAPP_ACCESS_TOKEN no Railway.
 *
 * Modo backend (padrão — valida o deploy ativo):
 *   MEDICO_PASS='...' node scripts/validate-whatsapp-meta-token.mjs
 *
 * Modo direto (valida um token local antes do deploy, sem expor o valor no log):
 *   WHATSAPP_ACCESS_TOKEN='...' WHATSAPP_PHONE_NUMBER_ID='...' \
 *     node scripts/validate-whatsapp-meta-token.mjs --direct
 *
 * Env:
 *   BACKEND_URL — default staging backend
 *   MEDICO_USER — default drmax.matos
 *   MEDICO_PASS — obrigatório no modo backend para provar token vivo via API admin
 *   WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID,
 *   WHATSAPP_GRAPH_API_VERSION — modo --direct
 */
const BACKEND = String(
  process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app'
).replace(/\/$/, '');
const MEDICO_USER = String(process.env.MEDICO_USER || 'drmax.matos').trim();
const MEDICO_PASS = String(process.env.MEDICO_PASS || '').trim();
const DIRECT = process.argv.includes('--direct');
const API_VERSION = String(process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0').trim();

const report = {
  generated_at: new Date().toISOString(),
  mode: DIRECT ? 'direct' : 'backend',
  targets: { BACKEND },
  steps: [],
  success: false,
  warnings: []
};

function step(name, ok, extra = {}) {
  report.steps.push({ name, ok: Boolean(ok), ...extra });
}

function warn(message) {
  report.warnings.push(message);
}

async function fetchJson(url, options = {}) {
  const started = Date.now();
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, ok: res.status >= 200 && res.status < 300, json, latency_ms: Date.now() - started };
}

async function validateBackend() {
  const health = await fetchJson(`${BACKEND}/health`);
  step('backend_health', health.ok, { status: health.status, latency_ms: health.latency_ms });
  if (!health.ok) return;

  const provider = await fetchJson(`${BACKEND}/api/whatsapp/provider-status`);
  step('provider_status_http', provider.ok, { status: provider.status, latency_ms: provider.latency_ms });
  if (!provider.ok) return;

  const ps = provider.json || {};
  step('provider_is_meta', ps.provider === 'meta', { provider: ps.provider });
  step('meta_vars_present', ps.meta?.configured === true, {
    configuredParts: ps.meta?.configuredParts || null,
    templatesConfigured: ps.meta?.templatesConfigured ?? null
  });
  step('real_mode_active', ps.mode === 'real' && ps.fallbackActive !== true, {
    mode: ps.mode,
    fallbackActive: ps.fallbackActive,
    sandboxMode: ps.sandboxMode,
    dryRun: ps.dryRun
  });

  if (ps.mode !== 'real' || ps.fallbackActive) {
    warn('Backend está em modo mock/fallback — confira WHATSAPP_PROVIDER=meta e variáveis Meta no Railway.');
  }

  if (!MEDICO_PASS) {
    step('backend_token_live', false, {
      skipped: true,
      reason: 'Defina MEDICO_PASS para validar o token via GET /api/admin/whatsapp/templates'
    });
    warn('MEDICO_PASS ausente: não foi possível provar que o token configurado funciona na Graph API.');
    return;
  }

  const login = await fetchJson(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: MEDICO_USER, username: MEDICO_USER, password: MEDICO_PASS })
  });
  step('admin_login', login.ok && login.json?.token, {
    status: login.status,
    error: login.json?.error || null
  });
  if (!login.ok || !login.json?.token) return;

  const token = login.json.token;
  const templates = await fetchJson(`${BACKEND}/api/admin/whatsapp/templates?limit=3`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const templateCount = Array.isArray(templates.json?.templates) ? templates.json.templates.length : 0;
  step('backend_token_live', templates.ok && templateCount >= 0, {
    status: templates.status,
    templateCount,
    code: templates.json?.code || null,
    error: templates.json?.error || null
  });

  if (templates.status === 502 || templates.json?.code === 'PROVIDER_ERROR') {
    warn('Token Meta rejeitado ou expirado — atualize WHATSAPP_ACCESS_TOKEN no Railway e redeploy.');
  }
}

async function graphGet(path, accessToken) {
  const url = path.startsWith('http')
    ? path
    : `https://graph.facebook.com/${API_VERSION}/${path.replace(/^\//, '')}`;
  return fetchJson(url, { headers: { Authorization: `Bearer ${accessToken}` } });
}

function formatExpiry(unixSeconds) {
  if (!unixSeconds) return null;
  const date = new Date(Number(unixSeconds) * 1000);
  const hoursLeft = (date.getTime() - Date.now()) / (1000 * 60 * 60);
  return { iso: date.toISOString(), hours_left: Math.round(hoursLeft * 10) / 10 };
}

async function validateDirect() {
  const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const wabaId = String(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '').trim();

  if (!accessToken) {
    step('direct_token_present', false, { reason: 'WHATSAPP_ACCESS_TOKEN ausente' });
    return;
  }
  step('direct_token_present', true, { token_length: accessToken.length });

  const debug = await graphGet(
    `debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(accessToken)}`,
    accessToken
  );
  const data = debug.json?.data || {};
  step('graph_token_valid', debug.ok && data.is_valid === true, {
    status: debug.status,
    type: data.type || null,
    app_id: data.app_id || null,
    application: data.application || null,
    scopes: (data.scopes || []).filter((s) => s.includes('whatsapp'))
  });

  const expiry = formatExpiry(data.expires_at);
  step('graph_token_not_expired', expiry ? expiry.hours_left > 0 : false, expiry || {});
  if (expiry && expiry.hours_left <= 0) {
    warn('Token expirado — gere um novo no Meta Business Manager.');
  } else if (expiry && expiry.hours_left < 24) {
    warn(`Token expira em ~${expiry.hours_left}h — prefira System User token de longa duração para produção.`);
  }

  if (!phoneNumberId) {
    step('graph_phone_number', false, {
      skipped: true,
      reason: 'Defina WHATSAPP_PHONE_NUMBER_ID para validar o número business'
    });
  } else {
    const phone = await graphGet(
      `${phoneNumberId}?fields=id,display_phone_number,verified_name,status,quality_rating`,
      accessToken
    );
    const p = phone.json || {};
    step('graph_phone_number', phone.ok && p.status === 'CONNECTED', {
      status: phone.status,
      id: p.id || phoneNumberId,
      display_phone_number: p.display_phone_number || null,
      verified_name: p.verified_name || null,
      phone_status: p.status || null,
      quality_rating: p.quality_rating || null,
      error: p.error?.message || null
    });
  }

  if (!wabaId) {
    step('graph_templates', false, {
      skipped: true,
      reason: 'Defina WHATSAPP_BUSINESS_ACCOUNT_ID para listar templates da WABA'
    });
  } else {
    const templates = await graphGet(`${wabaId}/message_templates?limit=3`, accessToken);
    const count = Array.isArray(templates.json?.data) ? templates.json.data.length : 0;
    step('graph_templates', templates.ok, {
      status: templates.status,
      templateCount: count,
      error: templates.json?.error?.message || null
    });
  }
}

async function main() {
  if (DIRECT) {
    await validateDirect();
  } else {
    await validateBackend();
  }

  report.success = report.steps.every((s) => s.ok || s.skipped);
  report.failures = report.steps.filter((s) => !s.ok && !s.skipped).map((s) => s.name);

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(JSON.stringify({ success: false, error: error.message }));
  process.exit(1);
});
