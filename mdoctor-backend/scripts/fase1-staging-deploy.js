/**
 * Fase 1 — publicação staging: validações locais, n8n, Typebot (opcional), smoke HTTP.
 *
 * Env:
 *   TYPEBOT_API_TOKEN — publica Typebot se definido
 *   N8N_API_KEY ou N8N_OWNER_* — republica workflows n8n
 *   BACKEND_URL — default staging backend
 *   N8N_WEBHOOK_SECRET — smoke typebot webhook
 *   SKIP_TYPEBOT=1 | SKIP_N8N=1 | SKIP_SMOKE=1
 */

const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '../..');
const backendUrl = String(process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(
  /\/$/,
  ''
);
const n8nUrl = String(process.env.N8N_BASE_URL || 'https://n8n-staging-staging-2dfe.up.railway.app').replace(/\/$/, '');

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: opts.cwd || root, env: { ...process.env, ...opts.env } });
}

function runJson(cmd, opts = {}) {
  const out = execSync(cmd, { cwd: opts.cwd || root, env: { ...process.env, ...opts.env }, encoding: 'utf8' });
  return out.trim();
}

async function smokeTypebotWebhook() {
  const secret = process.env.N8N_WEBHOOK_SECRET || '';
  const phone = `5511988${String(Date.now()).slice(-6)}`;
  const body = {
    patient_name: 'Smoke Fase1',
    whatsapp: phone,
    telefone: phone,
    from: phone,
    cpf: '52998224725',
    birth_date: '09/02/1988',
    email: 'smoke@example.com',
    address: 'Rua Smoke 1',
    cep: '01310100',
    chronic_condition: 'has',
    tempo_uso: 'Mais de 6 meses',
    has_previous_prescription: 'sim',
    previous_prescription_file: 'https://example.com/receita-smoke.jpg',
    sinais_alerta: 'NAO',
    eligibility_status: 'eligible',
    pagamento_status: 'paid',
    primeiro_medicamento: 'losartana 50 tomo 1x ao dia'
  };

  const headers = { 'Content-Type': 'application/json' };
  if (secret) headers['X-MDoctor-Webhook-Secret'] = secret;

  const res = await fetch(`${n8nUrl}/webhook/typebot-webhook`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

async function main() {
  const report = { startedAt: new Date().toISOString(), steps: [] };

  run('node mdoctor-backend/scripts/validate-typebot-staging-safe.js');
  report.steps.push({ name: 'validate_typebot_json', ok: true });

  run('node mdoctor-backend/scripts/test-fase1-payload-normalizer.js');
  report.steps.push({ name: 'test_normalizer', ok: true });

  run('node mdoctor-backend/scripts/test-typebot-eligibility.js');
  report.steps.push({ name: 'test_eligibility', ok: true });

  run('node mdoctor-backend/scripts/embed-n8n-typebot-payload.js');
  report.steps.push({ name: 'embed_n8n_payload', ok: true });

  if (process.env.SKIP_N8N !== '1') {
    const workflows = [
      'docs/n8n-workflows/typebot-webhook-staging.json',
      'docs/n8n-workflows/clinical-rejection-notify-staging.json'
    ];
    for (const wf of workflows) {
      const abs = path.join(root, wf).replace(/\\/g, '/');
      if (process.env.N8N_API_KEY) {
        run(`node mdoctor-backend/scripts/deploy-n8n-workflow.js`, {
          env: { N8N_WORKFLOW_FILE: abs }
        });
      } else {
        run(`node mdoctor-backend/scripts/n8n-activate-workflow.js`, {
          env: { N8N_WORKFLOW_FILE: abs }
        });
      }
      report.steps.push({ name: `n8n_${path.basename(wf)}`, ok: true });
    }
  }

  if (process.env.SKIP_TYPEBOT !== '1' && process.env.TYPEBOT_API_TOKEN) {
    run('node mdoctor-backend/scripts/publish-typebot-staging.js');
    report.steps.push({ name: 'typebot_publish', ok: true });
  } else {
    report.steps.push({ name: 'typebot_publish', skipped: true, reason: 'TYPEBOT_API_TOKEN missing or SKIP_TYPEBOT=1' });
  }

  const health = await fetch(`${backendUrl}/health`);
  report.steps.push({ name: 'backend_health', status: health.status, ok: health.ok });

  if (process.env.SKIP_SMOKE !== '1') {
    const smoke = await smokeTypebotWebhook();
    report.steps.push({
      name: 'smoke_n8n_typebot_webhook',
      status: smoke.status,
      ok: smoke.status >= 200 && smoke.status < 300,
      correlationId: smoke.data?.correlationId
    });
  }

  console.log('\n=== FASE1 DEPLOY REPORT ===');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
