#!/usr/bin/env node

require('./load-dotenv');

const { initSupabase } = require('../src/config/supabase');
const {
  STATUS,
  getAtendimento,
  updateAtendimentoStatus
} = require('../src/store/atendimentos.store');
const { ensurePrescriptionUploadSession } = require('../src/services/prescription-upload-token.service');
const { createAuditLog } = require('../src/store/audit.store');

const atendimentoId = process.argv[2];
const paymentIntentId = process.argv[3];
const EXPECTED_AMOUNT = 4990;
const EXPECTED_CURRENCY = 'brl';

async function fetchPaymentIntent(id) {
  const secretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!secretKey.startsWith('sk_live_')) throw new Error('STRIPE_SECRET_KEY de produção inválida');
  const response = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${secretKey}` }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Stripe recusou a consulta (${response.status})`);
  return body;
}

async function main() {
  if (!atendimentoId || !paymentIntentId) {
    throw new Error('Uso: recover-paid-typebot-numeric-condition.js <atendimentoId> <paymentIntentId>');
  }

  initSupabase();
  const atendimento = await getAtendimento(atendimentoId);
  if (!atendimento) throw new Error('Atendimento não encontrado');

  const currentCondition = String(atendimento.condicao || '').trim();
  const alreadyRecovered =
    atendimento.status === STATUS.AWAITING_PRESCRIPTION_UPLOAD &&
    String(atendimento.pagamento_status || '').toUpperCase() === 'CONFIRMADO' &&
    atendimento.dados_clinicos?.prescription_upload_session?.token;
  if (alreadyRecovered) {
    return { ok: true, duplicate: true, atendimentoId, status: atendimento.status };
  }

  if (atendimento.status !== STATUS.REJECTED || currentCondition !== '1') {
    throw new Error(`Estado inesperado para recuperação: status=${atendimento.status}, condicao=${currentCondition}`);
  }

  const paymentIntent = await fetchPaymentIntent(paymentIntentId);
  if (
    paymentIntent.status !== 'succeeded' ||
    paymentIntent.amount_received !== EXPECTED_AMOUNT ||
    paymentIntent.currency !== EXPECTED_CURRENCY
  ) {
    throw new Error('Pagamento não corresponde à cobrança confirmada de R$ 49,90 em BRL');
  }

  const recoveredAt = new Date().toISOString();
  const clinical = atendimento.dados_clinicos || {};
  const eligibility = {
    ...(atendimento.elegibilidade || {}),
    eligible: true,
    reason: 'Condição numérica normalizada; pagamento confirmado; aguardando receita anterior',
    reasonCode: 'eligible',
    riskLevel: 'BAIXO',
    renewalStatus: 'pendente_documentacao',
    conditionNormalized: 'hipertensao',
    flags: ['aguardando_upload_receita']
  };

  const updated = await updateAtendimentoStatus(atendimentoId, STATUS.AWAITING_PRESCRIPTION_UPLOAD, {
    status_anterior: atendimento.status,
    motivo: 'Recuperação autorizada: condição Typebot 1 normalizada e pagamento Stripe confirmado',
    pagamento_status: 'CONFIRMADO',
    condicao: 'Hipertensão arterial',
    risco: 'BAIXO',
    elegibilidade: eligibility,
    dados_clinicos: {
      ...clinical,
      previous_prescription: true,
      stripe_payment: {
        ...(clinical.stripe_payment || {}),
        payment_intent: paymentIntent.id,
        amount_cents: EXPECTED_AMOUNT,
        confirmed_at: recoveredAt,
        recovery_source: 'verified_stripe_payment_intent'
      }
    },
    snapshot: {
      operation: 'recover_paid_typebot_numeric_condition',
      payment_intent: paymentIntent.id
    }
  });
  if (!updated) throw new Error('Falha ao atualizar atendimento');

  const upload = await ensurePrescriptionUploadSession({
    atendimentoId,
    patientId: atendimento.patient_id || null,
    correlationId: `manual-recovery-${paymentIntent.id}`
  });

  await createAuditLog({
    entity_type: 'appointment',
    entity_id: atendimentoId,
    action: 'paid_typebot_numeric_condition_recovered',
    actor: 'codex-authorized-recovery',
    payload: {
      previous_status: atendimento.status,
      payment_intent: paymentIntent.id,
      amount_cents: EXPECTED_AMOUNT,
      condition_from: currentCondition,
      condition_to: 'hipertensao',
      upload_session_created: Boolean(upload?.token)
    }
  });

  return {
    ok: true,
    duplicate: false,
    atendimentoId,
    status: STATUS.AWAITING_PRESCRIPTION_UPLOAD,
    pagamentoStatus: 'CONFIRMADO',
    uploadSessionReady: Boolean(upload?.token)
  };
}

main()
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  })
  .catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exit(1);
  });
