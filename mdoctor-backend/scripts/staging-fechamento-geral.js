/**
 * Fechamento geral staging — validações locais + smoke HTTP (sem alterar produção).
 *
 * Env opcionais:
 *   TYPEBOT_API_TOKEN — publica Typebot se definido
 *   N8N_API_KEY + N8N_WORKFLOW_FILE — republica workflow via API
 *   N8N_WEBHOOK_SECRET — smoke n8n/backend (obrigatório para smoke)
 *   SKIP_SMOKE=1 | SKIP_TYPEBOT=1
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '../..');
const reportPath = path.join(root, 'docs/STAGING-FECHAMENTO-GERAL.json');

function run(cmd, cwd = root) {
  execSync(cmd, { stdio: 'pipe', cwd, encoding: 'utf8' });
}

function tryRun(name, cmd, cwd = root) {
  try {
    run(cmd, cwd);
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, error: String(error.message || error).slice(0, 400) };
  }
}

async function httpOk(url) {
  try {
    const res = await fetch(url, { method: 'GET' });
    return { url, ok: res.ok, status: res.status };
  } catch (error) {
    return { url, ok: false, error: error.message };
  }
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    branch: 'codex/legacy-compat-infra',
    local: [],
    remote: [],
    smoke: null,
    pending: [],
    urls: {
      backend: 'https://mdoctor-backend-staging-staging.up.railway.app',
      panel: 'https://painel-medico-staging-staging.up.railway.app',
      n8n: 'https://n8n-staging-staging-2dfe.up.railway.app',
      n8nTypebotWebhook: 'https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook',
      evolution: 'https://evolution-api-staging-staging-40d1.up.railway.app',
      typebotPublic: 'https://typebot.co/doctor-prescreve-8rmljgu'
    }
  };

  report.local.push(tryRun('validate_typebot', 'node mdoctor-backend/scripts/validate-typebot-staging-safe.js'));
  report.local.push(tryRun('test_eligibility', 'node mdoctor-backend/scripts/test-typebot-eligibility.js'));
  report.local.push(tryRun('test_normalizer', 'node mdoctor-backend/scripts/test-fase1-payload-normalizer.js'));
  report.local.push(tryRun('embed_n8n_payload', 'node mdoctor-backend/scripts/embed-n8n-typebot-payload.js'));
  const panelDir = path.join(root, 'mdoctor-panel');
  const nextDir = path.join(panelDir, '.next');
  if (fs.existsSync(nextDir)) {
    fs.rmSync(nextDir, { recursive: true, force: true });
  }
  report.local.push(tryRun('panel_lint', 'npm run lint', panelDir));
  report.local.push(tryRun('panel_build', 'npm run build', panelDir));

  report.remote.push(await httpOk(`${report.urls.backend}/health`));
  report.remote.push(await httpOk(`${report.urls.panel}/login`));
  report.remote.push(await httpOk(`${report.urls.panel}/dashboard`));
  report.remote.push(await httpOk(report.urls.n8n));

  if (process.env.SKIP_SMOKE !== '1' && process.env.N8N_WEBHOOK_SECRET) {
    try {
      const out = execSync('node mdoctor-backend/scripts/smoke-fase1-staging.js', {
        cwd: root,
        encoding: 'utf8',
        env: process.env
      });
      report.smoke = JSON.parse(out);
    } catch (error) {
      report.smoke = { success: false, error: String(error.stdout || error.message).slice(0, 500) };
    }
  } else {
    report.smoke = { skipped: true, reason: 'SKIP_SMOKE or N8N_WEBHOOK_SECRET missing' };
  }

  if (process.env.SKIP_TYPEBOT !== '1' && process.env.TYPEBOT_API_TOKEN) {
    report.remote.push(
      tryRun('typebot_publish', 'node mdoctor-backend/scripts/publish-typebot-staging.js')
    );
  } else {
    report.pending.push('Publicar Typebot: definir TYPEBOT_API_TOKEN e rodar publish-typebot-staging.js');
  }

  if (!process.env.N8N_API_KEY) {
    report.pending.push('Republicar workflows n8n via API: definir N8N_API_KEY e deploy-n8n-workflow.js (3 JSONs staging)');
  }

  report.pending.push(
    'Redeploy Railway backend/painel após push do branch codex/legacy-compat-infra (alterações locais ainda não commitadas)'
  );

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nReport saved: ${reportPath}`);

  const localOk = report.local.every((s) => s.ok);
  const smokeOk = report.smoke?.success !== false;
  if (!localOk || !smokeOk) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
