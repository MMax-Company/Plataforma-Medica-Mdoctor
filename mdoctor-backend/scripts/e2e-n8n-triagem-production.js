#!/usr/bin/env node
const N8N = String(
  process.env.N8N_WEBHOOK_URL || 'https://n8n-node-production-f844.up.railway.app/webhook/typebot-webhook'
).replace(/\/$/, '');

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
    observacoes: 'E2E n8n prod triagem'
  }
};

async function main() {
  const key = `e2e-n8n-${Date.now()}`;
  const res = await fetch(N8N, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': key,
      'Idempotency-Key': key
    },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  console.log(JSON.stringify({ status: res.status, body }, null, 2));
  if (res.status !== 200 || body.success !== true || !body.atendimentoId) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
