#!/usr/bin/env node
/**
 * Unit checks for nested triagem mapper + optional HTTP probe.
 *   node mdoctor-backend/scripts/test-triagem-webhook.js
 *   BACKEND_URL=... N8N_WEBHOOK_SECRET=... node mdoctor-backend/scripts/test-triagem-webhook.js --http
 */
const {
  validateNestedTriagemPayload,
  nestedTriagemToTypebotFlatBody
} = require('../src/services/triagem-nested.mapper');
const { mapTypebotPayload } = require('../src/services/typebot-payload.mapper');

function assert(label, condition) {
  console.log(condition ? `OK  ${label}` : `FAIL ${label}`);
  if (!condition) process.exitCode = 1;
}

const sample = {
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
    observacoes: 'teste'
  }
};

const valid = validateNestedTriagemPayload(sample);
assert('valid payload', valid.ok === true);

const invalid = validateNestedTriagemPayload({ paciente: { nome: 'x' } });
assert('invalid missing triagem', invalid.ok === false && invalid.status === 400);

const flat = nestedTriagemToTypebotFlatBody(valid.paciente, valid.triagem);
assert('flat patient_name', flat.patient_name === 'Teste Max');
assert('flat doenca', flat.doenca_cronica.includes('hipertens'));

const mapped = mapTypebotPayload(flat);
assert('mapped normalized name', mapped.normalized.patient_name === 'Teste Max');

async function httpProbe() {
  const base = String(process.env.BACKEND_URL || 'http://127.0.0.1:3004').replace(/\/$/, '');
  const secret = process.env.N8N_WEBHOOK_SECRET || '';
  const headers = {
    'Content-Type': 'application/json',
    'X-Correlation-Id': `test-triagem-${Date.now()}`,
    'Idempotency-Key': `test-triagem-${Date.now()}`
  };
  if (secret) headers['X-MDoctor-Webhook-Secret'] = secret;

  const health = await fetch(`${base}/healthz`);
  assert('http healthz', health.ok);

  const res = await fetch(`${base}/api/webhook/triagem`, {
    method: 'POST',
    headers,
    body: JSON.stringify(sample)
  });
  const body = await res.json();
  console.log('HTTP', res.status, JSON.stringify(body, null, 2));
  assert('http triagem 200', res.status === 200);
  assert('http success true', body.success === true);
  assert('http atendimentoId', Boolean(body.atendimentoId));
}

(async () => {
  if (process.argv.includes('--http')) {
    await httpProbe();
  }
  console.log('Done.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
