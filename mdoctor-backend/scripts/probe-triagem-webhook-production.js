#!/usr/bin/env node
const BACKEND = String(
  process.env.BACKEND_URL || 'https://web-production-5f178.up.railway.app'
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
    observacoes: 'probe production triagem E2E'
  }
};

async function main() {
  if (!SECRET) {
    console.error('N8N_WEBHOOK_SECRET is required');
    process.exit(1);
  }

  const health = await fetch(`${BACKEND}/healthz`);
  console.log('healthz', health.status, (await health.text()).slice(0, 120));

  const key = `probe-prod-triagem-${Date.now()}`;
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

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
