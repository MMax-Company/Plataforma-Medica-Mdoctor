const logger = require('../config/logger');
const { createAuditLog } = require('../store/audit.store');
const {
  STATUS,
  getAtendimento,
  updateAtendimentoStatus
} = require('../store/atendimentos.store');
const { findPaymentEventByProviderId, recordStripePaymentEvent } = require('../store/payments.store');
const { recordIntegrationLog } = require('./clinical-persistence.service');
const { isExternalUploadEnabled, ensurePrescriptionUploadSession } = require('./prescription-upload-token.service');
const {
  applyCheckoutWebhook,
  completePaymentByToken,
  findSessionByPaymentIntentId
} = require('./typebot-payment-link.service');

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

async function handleTypebotPaymentWebhook(event) {
  const object = event?.data?.object || {};

  if (event.type === 'checkout.session.completed') {
    const token = String(object.metadata?.payment_token || '').trim();
    const typebotSessionId = String(object.metadata?.typebot_session_id || '').trim();
    if (!token && !typebotSessionId) return null;
    const applied = await applyCheckoutWebhook(event);
    if (!applied.ok) {
      if (applied.code === 'SESSION_NOT_FOUND') return null;
      logger.warn('stripe_webhook_typebot_checkout_rejected', {
        eventId: event.id,
        code: applied.code
      });
      return { status: 200, body: { success: true, ignored: true, reason: applied.code } };
    }
    try {
      const result = await completePaymentByToken(applied.token, { session: applied.session });
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
        token_suffix: String(applied.token).slice(-8),
        error: error.message
      });
      return { status: 500, body: { success: false, error: error.message } };
    }
  }

  if (event.type === 'payment_intent.succeeded') {
    // FASE 4B: cobrança ativa do WhatsApp é somente Checkout Session.
    // PaymentIntent legado (bloco payment input do Typebot) não confirma nem retoma o fluxo.
    const intentId = String(object.payment_intent || object.id || '').trim();
    const session = intentId ? await findSessionByPaymentIntentId(intentId) : null;
    if (session?.metadata?.typebot_payment?.token) {
      logger.info('stripe_webhook_typebot_pi_ignored', {
        eventId: event.id,
        intentId,
        reason: 'whatsapp_checkout_only'
      });
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: 'whatsapp_checkout_only',
          typebot_payment: true
        }
      };
    }
    return null;
  }

  return null;
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

  // FASE 5B: AWAITING sempre com prescription_upload_session.
  if (nextStatus === STATUS.AWAITING_PRESCRIPTION_UPLOAD) {
    await ensurePrescriptionUploadSession({
      atendimentoId,
      patientId: atendimento.patient_id || null,
      correlationId: stripeMeta.eventId || null
    }).catch((error) => {
      logger.warn('stripe_webhook_upload_session_ensure_failed', {
        atendimentoId,
        error: error.message
      });
    });
  }

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

// Pagamento WhatsApp/Typebot (Fase 2 pedido 2): Checkout Session criado
// pelo Backend, confirmado somente pelo webhook Stripe. checkout.session.completed
// é o evento oficial dessa cobrança; payment_intent.succeeded é ignorado
// aqui de propósito — o Typebot nunca confirma pagamento sozinho, e usar o
// PaymentIntent para confirmar abriria uma segunda via de confirmação sem
// prova de Checkout Session paga (valor/moeda) desta sessão.
async function handleTypebotPaymentWebhook(event) {
  const object = event?.data?.object || {};

  if (event.type === 'checkout.session.completed') {
    const token = String(object.metadata?.payment_token || '').trim();
    const typebotSessionId = String(object.metadata?.typebot_session_id || '').trim();
    if (!token && !typebotSessionId) return null;
    const applied = await applyCheckoutWebhook(event);
    if (!applied.ok) {
      if (applied.code === 'SESSION_NOT_FOUND') return null;
      logger.warn('stripe_webhook_typebot_checkout_rejected', {
        eventId: event.id,
        code: applied.code
      });
      return { status: 200, body: { success: true, ignored: true, reason: applied.code } };
    }
    try {
      const result = await completePaymentByToken(applied.token, { session: applied.session });
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
        token_suffix: String(applied.token).slice(-8),
        error: error.message
      });
      return { status: 500, body: { success: false, error: error.message } };
    }
  }

  if (event.type === 'payment_intent.succeeded') {
    const intentId = String(object.payment_intent || object.id || '').trim();
    const session = intentId ? await findSessionByPaymentIntentId(intentId) : null;
    if (session?.metadata?.typebot_payment?.token) {
      logger.info('stripe_webhook_typebot_pi_ignored', {
        eventId: event.id,
        intentId,
        reason: 'whatsapp_checkout_only'
      });
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: 'whatsapp_checkout_only',
          typebot_payment: true
        }
      };
    }
    return null;
  }

  return null;
}

async function handleStripeWebhookEvent(event) {
  if (!event?.type) {
    return { status: 400, body: { success: false, error: 'Evento Stripe inválido' } };
  }

  if (!isPaidStripeEvent(event.type)) {
    return { status: 200, body: { success: true, ignored: true, type: event.type } };
  }

  // Fluxo WhatsApp/Typebot (Checkout Session + payment_token/typebot_session_id
  // no metadata) é tratado à parte, antes do fluxo por atendimento_id abaixo
  // (usado pelo painel/Memed com client_reference_id direto). Não altera nem
  // duplica esse segundo fluxo — só sai mais cedo quando o evento é typebot.
  const typebotResult = await handleTypebotPaymentWebhook(event);
  if (typebotResult) return typebotResult;

  const atendimentoId = extractAtendimentoId(event);
  if (!atendimentoId) {
    logger.warn('stripe_webhook_missing_atendimento_id', { type: event.type, id: event.id });
    return { status: 200, body: { success: true, ignored: true, reason: 'missing_atendimento_id' } };
  }

  const object = event.data?.object || {};
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
  handleStripeWebhookEvent,
  handleTypebotPaymentWebhook
};
