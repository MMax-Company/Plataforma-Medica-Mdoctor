const logger = require('../config/logger');
const { createAuditLog } = require('../store/audit.store');
const { findPaymentByAppointment, markPaymentRefunded } = require('../store/payments.store');

// Estados em que um estorno já iniciado NÃO pode ser repetido.
const REFUND_LOCKED_STATUSES = new Set(['succeeded', 'pending', 'requires_action', 'already_refunded']);

function getStripeClient() {
  const secretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!secretKey) return null;
  // eslint-disable-next-line global-require
  return require('stripe')(secretKey);
}

function isRefundLocked(estorno = null) {
  return Boolean(estorno && REFUND_LOCKED_STATUSES.has(String(estorno.status || '')));
}

// O vínculo pagamento↔atendimento pode existir em três lugares, em ordem de
// confiabilidade: payment_intent explícito na request (admin), o snapshot
// stripe_payment gravado pelo webhook Stripe em dados_clinicos, e a tabela
// payments. IDs de Checkout Session (cs_...) são resolvidos para o
// payment_intent via API.
async function resolvePaymentIntentId({ stripe, atendimento, requestedPaymentIntent }) {
  const clinical = atendimento?.dados_clinicos || {};
  const stored = clinical.stripe_payment || {};
  const candidates = [];

  if (requestedPaymentIntent) {
    candidates.push({ value: String(requestedPaymentIntent).trim(), source: 'request' });
  }
  if (stored.payment_intent) {
    candidates.push({ value: String(stored.payment_intent).trim(), source: 'clinical_data.stripe_payment' });
  }
  if (stored.session_id) {
    candidates.push({ value: String(stored.session_id).trim(), source: 'clinical_data.stripe_payment.session_id' });
  }

  const paymentRow = await findPaymentByAppointment(atendimento?.id).catch(() => null);
  if (paymentRow?.metadata?.payment_intent) {
    candidates.push({ value: String(paymentRow.metadata.payment_intent).trim(), source: 'payments.metadata' });
  }
  if (paymentRow?.external_id) {
    candidates.push({ value: String(paymentRow.external_id).trim(), source: 'payments.external_id' });
  }

  for (const candidate of candidates) {
    if (!candidate.value) continue;
    if (candidate.value.startsWith('pi_')) {
      return { paymentIntentId: candidate.value, source: candidate.source, paymentRow };
    }
    if (candidate.value.startsWith('cs_') && stripe) {
      try {
        const session = await stripe.checkout.sessions.retrieve(candidate.value);
        const resolved = session?.payment_intent;
        if (resolved) {
          return {
            paymentIntentId: typeof resolved === 'string' ? resolved : resolved.id,
            source: `${candidate.source}:checkout_session`,
            paymentRow
          };
        }
      } catch (error) {
        logger.warn('refund_checkout_session_resolve_failed', {
          atendimentoId: atendimento?.id,
          error: error.message
        });
      }
    }
  }

  return { paymentIntentId: null, source: null, paymentRow };
}

// Estorno de reprovação médica — único ponto autorizado a estornar. Recusa
// automática da triagem, abandono e erro técnico nunca chegam aqui (só o
// POST /:id/clinical/reject chama). Idempotente em dois níveis: o estado
// `estorno` já persistido no atendimento e a idempotency key da API Stripe.
async function refundRejectedAtendimento({ atendimento, requestedPaymentIntent = null, doctorId = null, correlationId = null }) {
  const atendimentoId = atendimento?.id || null;
  const existing = atendimento?.dados_clinicos?.estorno || null;

  if (existing?.refund_id && isRefundLocked(existing)) {
    return { ...existing, duplicate: true };
  }

  const base = {
    requested_at: new Date().toISOString(),
    requested_by: doctorId || null,
    correlation_id: correlationId || null,
    attempt: Number(existing?.attempt || 0) + 1
  };

  const stripe = getStripeClient();
  if (!stripe) {
    return { ...base, status: 'error', error_code: 'STRIPE_NOT_CONFIGURED', error: 'STRIPE_SECRET_KEY ausente' };
  }

  const { paymentIntentId, source, paymentRow } = await resolvePaymentIntentId({
    stripe,
    atendimento,
    requestedPaymentIntent
  });

  if (!paymentIntentId) {
    await createAuditLog({
      entity_type: 'atendimento',
      entity_id: atendimentoId,
      action: 'refund_payment_not_found',
      actor: doctorId || 'backend',
      payload: { correlationId }
    });
    return {
      ...base,
      status: 'payment_not_found',
      error: 'Nenhum payment_intent ou checkout session Stripe vinculado a este atendimento'
    };
  }

  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        reason: 'requested_by_customer',
        metadata: {
          atendimento_id: String(atendimentoId || ''),
          motivo: 'reprovacao_medica',
          correlation_id: String(correlationId || '')
        }
      },
      { idempotencyKey: `clinical-reject-refund:${atendimentoId}:${base.attempt}` }
    );

    const estorno = {
      ...base,
      status: refund.status || 'pending',
      refund_id: refund.id,
      payment_intent: paymentIntentId,
      amount_cents: refund.amount ?? null,
      currency: refund.currency || null,
      source
    };

    if (paymentRow?.id && refund.status === 'succeeded') {
      await markPaymentRefunded(paymentRow.id).catch((error) =>
        logger.warn('refund_mark_payment_failed', { paymentId: paymentRow.id, error: error.message })
      );
    }

    await createAuditLog({
      entity_type: 'atendimento',
      entity_id: atendimentoId,
      action: 'refund_initiated',
      actor: doctorId || 'backend',
      payload: {
        correlationId,
        refund_id: refund.id,
        refund_status: refund.status,
        amount_cents: refund.amount ?? null,
        source
      }
    });

    return estorno;
  } catch (error) {
    const code = error?.code || error?.raw?.code || null;

    if (code === 'charge_already_refunded') {
      await createAuditLog({
        entity_type: 'atendimento',
        entity_id: atendimentoId,
        action: 'refund_already_done',
        actor: doctorId || 'backend',
        payload: { correlationId, payment_intent: paymentIntentId }
      });
      return { ...base, status: 'already_refunded', payment_intent: paymentIntentId, error_code: code, source };
    }

    await createAuditLog({
      entity_type: 'atendimento',
      entity_id: atendimentoId,
      action: 'refund_failed',
      actor: doctorId || 'backend',
      payload: { correlationId, payment_intent: paymentIntentId, error_code: code, error: error.message }
    });

    return {
      ...base,
      status: 'failed',
      payment_intent: paymentIntentId,
      error_code: code || 'REFUND_FAILED',
      error: error.message,
      source
    };
  }
}

module.exports = {
  REFUND_LOCKED_STATUSES,
  isRefundLocked,
  refundRejectedAtendimento,
  resolvePaymentIntentId
};
