const logger = require('../config/logger');
const { createAuditLog } = require('../store/audit.store');
const {
  STATUS,
  getAtendimento,
  updateAtendimentoStatus
} = require('../store/atendimentos.store');
const { findPaymentEventByProviderId, recordStripePaymentEvent } = require('../store/payments.store');
const { recordIntegrationLog } = require('./clinical-persistence.service');
const { isExternalUploadEnabled } = require('./prescription-upload-token.service');

function extractAtendimentoId(event) {
  const object = event?.data?.object || {};
  const metadata = object.metadata || {};
  return (
    metadata.atendimento_id ||
    metadata.atendimentoId ||
    object.client_reference_id ||
    null
  );
}

function isPaidStripeEvent(type) {
  return type === 'checkout.session.completed' || type === 'payment_intent.succeeded';
}

async function applyStripePaymentConfirmed(atendimentoId, stripeMeta = {}) {
  if (stripeMeta.eventId) {
    const prior = await findPaymentEventByProviderId('stripe', stripeMeta.eventId);
    if (prior) {
      const atendimento = await getAtendimento(atendimentoId);
      return { ok: true, duplicate: true, atendimento, paymentDuplicate: true };
    }
  }

  const atendimento = await getAtendimento(atendimentoId);
  if (!atendimento) {
    return { ok: false, reason: 'atendimento_not_found' };
  }

  const alreadyPaid = String(atendimento.pagamento_status || '').toUpperCase() === 'CONFIRMADO';
  if (alreadyPaid) {
    return { ok: true, duplicate: true, atendimento };
  }

  const eligible = atendimento.elegibilidade?.eligible !== false;
  let nextStatus = atendimento.status;
  if (eligible && String(atendimento.status || '').toLowerCase() === STATUS.WAITING) {
    nextStatus = isExternalUploadEnabled()
      ? STATUS.AWAITING_PRESCRIPTION_UPLOAD
      : STATUS.WAITING;
  }

  const updated = await updateAtendimentoStatus(atendimentoId, nextStatus, {
    pagamento_status: 'CONFIRMADO',
    dados_clinicos: {
      ...(atendimento.dados_clinicos || {}),
      stripe_payment: {
        event_id: stripeMeta.eventId || null,
        session_id: stripeMeta.sessionId || null,
        payment_intent: stripeMeta.paymentIntentId || null,
        confirmed_at: new Date().toISOString()
      }
    }
  });

  if (stripeMeta.eventId) {
    await recordStripePaymentEvent({
      appointmentId: atendimentoId,
      patientId: atendimento.patient_id || null,
      providerEventId: stripeMeta.eventId,
      eventType: stripeMeta.eventType,
      amountCents: stripeMeta.amountCents,
      payload: {
        session_id: stripeMeta.sessionId,
        payment_intent: stripeMeta.paymentIntentId
      }
    });
  }

  await createAuditLog({
    entity_type: 'stripe_webhook',
    entity_id: atendimentoId,
    action: 'payment_confirmed',
    actor: 'stripe',
    payload: {
      event_id: stripeMeta.eventId || null,
      session_id: stripeMeta.sessionId || null,
      payment_intent: stripeMeta.paymentIntentId || null
    }
  });

  await recordIntegrationLog({
    integration: 'stripe',
    correlationId: stripeMeta.eventId,
    requestPayload: { atendimentoId, type: stripeMeta.eventType },
    responsePayload: { status: updated?.status, pagamento_status: 'CONFIRMADO' }
  });

  return { ok: true, duplicate: false, atendimento: updated || atendimento };
}

async function handleStripeWebhookEvent(event) {
  if (!event?.type) {
    return { status: 400, body: { success: false, error: 'Evento Stripe inválido' } };
  }

  if (!isPaidStripeEvent(event.type)) {
    return { status: 200, body: { success: true, ignored: true, type: event.type } };
  }

  const object = event.data?.object || {};
  const atendimentoId = extractAtendimentoId(event);
  if (!atendimentoId) {
    if (event.type === 'payment_intent.succeeded') {
      const intentId = String(object.payment_intent || object.id || '').trim();
      if (intentId) {
        const {
          completePaymentByToken,
          findSessionByPaymentIntentId
        } = require('./typebot-payment-link.service');
        const session = await findSessionByPaymentIntentId(intentId);
        const token = session?.metadata?.typebot_payment?.token;
        if (token) {
          try {
            const result = await completePaymentByToken(token, { session });
            return {
              status: 200,
              body: {
                success: true,
                typebot_payment: true,
                duplicate: Boolean(result.alreadyCompleted),
                responsesSent: result.responsesSent ?? 0
              }
            };
          } catch (error) {
            logger.error('stripe_webhook_typebot_payment_resume_failed', {
              intentId,
              error: error.message
            });
            return { status: 500, body: { success: false, error: error.message } };
          }
        }
      }
    }
    logger.warn('stripe_webhook_missing_atendimento_id', { type: event.type, id: event.id });
    return { status: 200, body: { success: true, ignored: true, reason: 'missing_atendimento_id' } };
  }

  const result = await applyStripePaymentConfirmed(atendimentoId, {
    eventId: event.id,
    eventType: event.type,
    sessionId: object.id,
    paymentIntentId: object.payment_intent || object.id,
    amountCents: object.amount_total || object.amount_received || null
  });

  if (!result.ok) {
    return { status: 404, body: { success: false, error: 'Atendimento não encontrado', atendimentoId } };
  }

  return {
    status: 200,
    body: {
      success: true,
      duplicate: Boolean(result.duplicate),
      atendimentoId,
      status: result.atendimento?.status || null,
      pagamento_status: result.atendimento?.pagamento_status || 'CONFIRMADO'
    }
  };
}

module.exports = {
  applyStripePaymentConfirmed,
  extractAtendimentoId,
  handleStripeWebhookEvent
};
