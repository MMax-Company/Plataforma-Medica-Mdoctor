/**
 * Staging deploy 2/5–3/5 — Typebot publish + n8n workflows (requer tokens).
 * Passo 4/5 (git push) e 5/5 (WhatsApp manual) ficam fora deste script.
 */
const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '../..');

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: root, env: process.env });
}

const workflows = [
  'docs/n8n-workflows/typebot-webhook-staging.json',
  'docs/n8n-workflows/clinical-rejection-notify-staging.json',
  'docs/n8n-workflows/evolution-webhook-staging.json'
];

async function main() {
  run('node mdoctor-backend/scripts/patch-typebot-reorganize.js');
  run('node mdoctor-backend/scripts/validate-typebot-staging-safe.js');
  run('node mdoctor-backend/scripts/embed-n8n-typebot-payload.js');
  run('node mdoctor-backend/scripts/embed-n8n-whatsapp-menu.js');

  if (!process.env.TYPEBOT_API_TOKEN) {
    console.error('\nSKIP Typebot publish: TYPEBOT_API_TOKEN not set');
    process.exit(1);
  }
  run('node mdoctor-backend/scripts/publish-typebot-staging.js');

  if (!process.env.N8N_API_KEY) {
    console.error('\nSKIP n8n deploy: N8N_API_KEY not set');
    process.exit(1);
  }

  for (const wf of workflows) {
    const abs = path.join(root, wf).replace(/\\/g, '/');
    execSync('node mdoctor-backend/scripts/deploy-n8n-workflow.js', {
      stdio: 'inherit',
      cwd: root,
      env: { ...process.env, N8N_WORKFLOW_FILE: abs }
    });
  }

  if (process.env.N8N_WEBHOOK_SECRET) {
    run('node mdoctor-backend/scripts/smoke-fase1-staging.js');
  }

  console.log('\n=== Deploy 2/5–3/5 concluído. Próximo: git push + Railway (4/5) e teste WhatsApp (5/5). ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
