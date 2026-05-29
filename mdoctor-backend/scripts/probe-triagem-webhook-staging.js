#!/usr/bin/env node
/**
 * Probe staging: health + POST /api/webhook/triagem (nested payload).
 * Requires N8N_WEBHOOK_SECRET (Railway staging or local .env).
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const BACKEND = String(
  process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app'
).replace(/\/$/, '');
const SECRET = process.env.N8N_WEBHOOK_SECRET || '';

const payload = {
  paciente: {
    nome: 'Teste Max',
    telefone: '5511999999999',
    cpf: '00000000000',
    email: 'teste@doctorprescreve.com'
  },
  triagem: {
    doencas: 'hipertensão arterial',
    medicacao_em_uso: 'Losartana 50mg',
    tempo_uso: 'mais de 30 dias',
    receita_anterior: 'sim',
    sinais_alerta: 'não',
    observacoes: 'probe staging triagem'
  }
};

async function main() {
  if (!SECRET) {
    console.error('N8N_WEBHOOK_SECRET is required for staging probe');
    process.exit(1);
  }

  const health = await fetch(`${BACKEND}/healthz`);
  const healthBody = await health.text();
  console.log('healthz', health.status, healthBody.slice(0, 120));

  const key = `probe-triagem-${Date.now()}`;
  const res = await fetch(`${BACKEND}/api/webhook/triagem`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MDoctor-Webhook-Secret': SECRET,
      'X-Correlation-Id': key,
      'Idempotency-Key': key
    },
    body: JSON.stringify(payload)
  });
  const body = await res.json();
  console.log('triagem', res.status, JSON.stringify(body, null, 2));

  if (res.status !== 200 || body.success !== true || !body.atendimentoId) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
