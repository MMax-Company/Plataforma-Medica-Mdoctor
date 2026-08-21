const logger = require('../config/logger');
const { createAuditLog } = require('../store/audit.store');
const {
  STATUS,
  getAtendimento,
  listAtendimentos,
  updateAtendimentoStatus
} = require('../store/atendimentos.store');
const {
  findPaymentByAppointment,
  findPaymentEventByProviderId,
  markPaymentRefunded,
  recordStripePaymentEvent
} = require('../store/payments.store');
const { recordIntegrationLog } = require('./clinical-persistence.service');
const { isExternalUploadEnabled, ensurePrescriptionUploadSession } = require('./prescription-upload-token.service');
const {
  applyCheckoutWebhook,
  completePaymentByToken,
  findSessionByPaymentIntentId
} = require('./typebot-payment-link.service');
const { PAYMENT_AMOUNT_CENTS } = require('./typebot-payment.constants');

// Tempo entre o pagamento no bloco nativo do Typebot e a criação do
// atendimento pelo webhook de triagem — cobre CEP, receita anterior e coleta
// de medicamentos, que rodam DEPOIS do pagamento nesse fluxo. Usado só do
// lado de processTriagemWebhook (resolvePendingNativeTypebotPayment), que
// procura um PAGAMENTO órfão para o atendimento que acabou de nascer.
const NATIVE_PAYMENT_LOOKBACK_MS = 6 * 60 * 60 * 1000;

// Achado real 03/08/2026: usar essa mesma janela de 6h para o sentido
// INVERSO (webhook procurando um atendimento já existente) vinculou um
// PaymentIntent novo a um atendimento de ~2h atrás só porque nenhum dos dois
// tinha stripe_payment ainda — o atendimento certo (criado ~1s depois) nunca
// chegou a ser considerado. Nesse sentido só faz sentido casar quando o
// atendimento nasceu poucos instantes antes do webhook (o Typebot já estava
// no fluxo pós-pagamento); qualquer coisa mais velha que isso é sempre um
// atendimento de um teste/pagamento anterior, nunca o atual.
const NATIVE_PAYMENT_EXISTING_MATCH_WINDOW_MS = 3 * 60 * 1000;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

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

function isRefundStripeEvent(type) {
  return type === 'refund.created' || type === 'refund.updated' || type === 'refund.failed';
}

// Achado 02/08/2026: o endpoint Stripe já tem refund.created/updated/failed
// habilitados (necessário para Pix, cujo estorno pode ficar "pending" por
// minutos antes de resolver — diferente de cartão, que normalmente já volta
// succeeded na criação), mas o handler descartava esses eventos
// silenciosamente (isPaidStripeEvent só cobria checkout/payment_intent).
// Reconcilia dados_clinicos.estorno com o status final do refund. Nunca
// CRIA um estorno a partir de webhook — só atualiza um refund_id que o
// próprio backend já registrou via refundRejectedAtendimento
// (stripe-refund.service.js), então não há caminho para o cliente/painel
// forjar um estorno por aqui.
async function applyStripeRefundReconciliation(event) {
  const object = event?.data?.object || {};
  const atendimentoId = object.metadata?.atendimento_id || null;
  if (!atendimentoId) {
    return { status: 200, body: { success: true, ignored: true, reason: 'missing_atendimento_id' } };
  }

  const atendimento = await getAtendimento(atendimentoId);
  if (!atendimento) {
    return { status: 200, body: { success: true, ignored: true, reason: 'atendimento_not_found' } };
  }

  const clinical = atendimento.dados_clinicos || {};
  const currentEstorno = clinical.estorno || null;
  // Só reconcilia o MESMO refund que o backend já criou e registrou para
  // este atendimento — um refund.id diferente (ou nenhum estorno registrado
  // ainda) é ignorado, nunca grava por conta própria.
  if (!currentEstorno?.refund_id || currentEstorno.refund_id !== object.id) {
    return { status: 200, body: { success: true, ignored: true, reason: 'refund_not_linked' } };
  }

  const newRefundStatus = String(object.status || currentEstorno.status || '').trim();
  if (newRefundStatus === currentEstorno.status) {
    // Redelivery do mesmo status — nada a mudar, evita log de auditoria duplicado.
    return { status: 200, body: { success: true, duplicate: true, atendimentoId } };
  }

  const refundSucceeded = newRefundStatus === 'succeeded';
  const refundFailedFinal = newRefundStatus === 'failed';

  const nextEstorno = {
    ...currentEstorno,
    status: newRefundStatus,
    reconciled_at: new Date().toISOString(),
    reconciled_via_event_id: event.id || null
  };

  const nextPendenciaPagamento = refundSucceeded
    ? {
        ...(clinical.pendencia_pagamento || {}),
        status: 'estorno_concluido',
        motivo: 'Estorno confirmado pelo webhook Stripe',
        refund_id: object.id,
        refund_status: newRefundStatus,
        reconciled_at: new Date().toISOString()
      }
    : refundFailedFinal
      ? {
          ...(clinical.pendencia_pagamento || {}),
          status: 'pendente_analise_administrativa',
          motivo: `Estorno falhou de forma assíncrona (webhook Stripe, refund ${object.id}) — aguardando tratamento administrativo do pagamento`,
          refund_id: object.id,
          refund_status: newRefundStatus,
          reconciled_at: new Date().toISOString()
        }
      : {
          ...(clinical.pendencia_pagamento || {}),
          status: 'estorno_iniciado',
          refund_status: newRefundStatus
        };

  const updated = await updateAtendimentoStatus(atendimentoId, atendimento.status, {
    motivo: atendimento.motivo_decisao,
    medicoId: atendimento.medico_id,
    dados_clinicos: {
      ...clinical,
      estorno: nextEstorno,
      pendencia_pagamento: nextPendenciaPagamento
    }
  });

  if (currentEstorno.payment_intent) {
    // stripe-refund.service.js só marca payments.status = refunded quando o
    // refund já vem succeeded na criação (caminho síncrono). Fecha o mesmo
    // laço para o caminho assíncrono (ex.: Pix), sem duplicar lógica —
    // reaproveita o mesmo helper e a mesma tabela.
    if (refundSucceeded) {
      const paymentRow = await findPaymentByAppointment(atendimentoId).catch(() => null);
      if (paymentRow?.id) {
        await markPaymentRefunded(paymentRow.id).catch((error) =>
          logger.warn('stripe_webhook_refund_mark_payment_failed', { atendimentoId, error: error.message })
        );
      }
    }
  }

  await createAuditLog({
    entity_type: 'atendimento',
    entity_id: atendimentoId,
    action: 'refund_status_synced',
    actor: 'stripe',
    payload: {
      event_id: event.id || null,
      event_type: event.type,
      refund_id: object.id,
      refund_status: newRefundStatus,
      previous_status: currentEstorno.status
    }
  });

  return {
    status: 200,
    body: {
      success: true,
      atendimentoId,
      refund_id: object.id,
      refund_status: newRefundStatus,
      atendimento_status: updated?.status || atendimento.status
    }
  };
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
        amount_cents: stripeMeta.amountCents || null,
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

  // Gap real corrigido: esta confirmação de pagamento (fluxo painel/Memed,
  // client_reference_id) podia virar o status para AWAITING_PRESCRIPTION_UPLOAD
  // sem nunca criar a sessão/token de upload — o paciente ficava "aguardando
  // receita" sem nenhum vínculo em dados_clinicos.prescription_upload_session,
  // e findPendingUploadContext nunca encontrava nada quando a foto chegasse.
  if (nextStatus === STATUS.AWAITING_PRESCRIPTION_UPLOAD) {
    await ensurePrescriptionUploadSession({ atendimentoId, correlationId: stripeMeta.eventId });
  }

  return { ok: true, duplicate: false, atendimento: updated || atendimento };
}

// PaymentIntent criado pelo bloco de pagamento NATIVO do Typebot (Stripe
// conectado direto no bot — credencial "Doctor Prescreve Plataforma" — sem
// passar pelo Checkout Session do backend nem pelo client_reference_id do
// painel/Memed). Confirmado direto na Stripe real em 02/08/2026: esse
// PaymentIntent sempre tem metadata:{} e shipping:null — o único campo que
// sobrevive com o identificador do paciente é receipt_email
// (additionalInformation.email do bloco). Achado real: o primeiro estorno
// automático de reprovação não encontrou o pagamento por falta desse
// vínculo (recuperado manualmente uma única vez, ver PROJECT_MEMORY §8).
// Busca o atendimento (se já existe) pelo mesmo e-mail/valor/moeda e vincula
// na hora; senão grava um payment "órfão" (appointment_id null) para
// processTriagemWebhook consumir quando o atendimento nascer — nunca
// depende de recuperação manual.
async function linkOrRecordNativeTypebotPayment({ paymentIntentId, email, amountCents, currency, eventId }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    logger.warn('stripe_webhook_native_payment_missing_email', { eventId, paymentIntentId });
    return { ignored: true, reason: 'missing_email' };
  }

  const sinceTs = Date.now() - NATIVE_PAYMENT_EXISTING_MATCH_WINDOW_MS;
  const rows = await listAtendimentos();
  const match = rows.find((row) => {
    if (normalizeEmail(row.paciente_email) !== normalizedEmail) return false;
    if (row.dados_clinicos?.stripe_payment?.payment_intent) return false;
    const createdTs = Date.parse(row.criado_em || '') || 0;
    return createdTs >= sinceTs;
  });

  const recorded = await recordStripePaymentEvent({
    appointmentId: match?.id || null,
    patientId: match?.patient_id || null,
    providerEventId: eventId,
    eventType: 'payment_intent.succeeded',
    amountCents,
    currency: String(currency || 'BRL').toUpperCase(),
    payload: {
      receipt_email: normalizedEmail,
      payment_intent: paymentIntentId,
      source: 'typebot_native_payment_block',
      // Snapshot do instante do webhook (não é um status ao vivo): true
      // quando nenhum atendimento existente pôde ser vinculado aqui — nesse
      // caso o payments.appointment_id continua null até
      // resolvePendingNativeTypebotPayment (processTriagemWebhook) reivindicar
      // esse pagamento quando o atendimento nascer. Só para observabilidade.
      pending_link_at_webhook: !match
    }
  });

  if (recorded.duplicate) {
    return { duplicate: true, matched: Boolean(match) };
  }

  if (!match) {
    return { matched: false, orphan: true, paymentId: recorded.payment?.id || null };
  }

  const clinical = match.dados_clinicos || {};
  await updateAtendimentoStatus(match.id, match.status, {
    motivo: match.motivo_decisao,
    medicoId: match.medico_id,
    dados_clinicos: {
      ...clinical,
      payment_sync_source: clinical.payment_sync_source || 'stripe_native_payment_block',
      stripe_payment: {
        ...(clinical.stripe_payment || {}),
        event_id: eventId,
        payment_intent: paymentIntentId,
        amount_cents: amountCents,
        confirmed_at: new Date().toISOString()
      }
    }
  });

  await createAuditLog({
    entity_type: 'atendimento',
    entity_id: match.id,
    action: 'stripe_native_payment_linked',
    actor: 'stripe',
    payload: { event_id: eventId, payment_intent: paymentIntentId, amount_cents: amountCents }
  });

  return { matched: true, atendimentoId: match.id };
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

    // Já tem vínculo explícito com um atendimento (painel/Memed via
    // metadata.atendimento_id ou client_reference_id) — deixa cair no fluxo
    // existente por atendimento_id logo abaixo, nunca intercepta aqui.
    const hasExplicitAtendimentoLink = Boolean(
      object.metadata?.atendimento_id || object.metadata?.atendimentoId || object.client_reference_id
    );
    if (hasExplicitAtendimentoLink) return null;

    // Candidato a PaymentIntent do bloco nativo do Typebot: só intercepta
    // quando valor/moeda batem com a cobrança oficial do Doctor Prescreve —
    // qualquer outra combinação segue ignorada como antes (return null).
    const amountCents = object.amount_received ?? object.amount ?? null;
    const currency = String(object.currency || '').toLowerCase();
    if (amountCents !== PAYMENT_AMOUNT_CENTS || currency !== 'brl') return null;

    const result = await linkOrRecordNativeTypebotPayment({
      paymentIntentId: object.id,
      email: object.receipt_email,
      amountCents,
      currency,
      eventId: event.id
    });
    return { status: 200, body: { success: true, typebot_native_payment: true, ...result } };
  }

  return null;
}

async function handleStripeWebhookEvent(event) {
  if (!event?.type) {
    return { status: 400, body: { success: false, error: 'Evento Stripe inválido' } };
  }

  if (isRefundStripeEvent(event.type)) {
    return applyStripeRefundReconciliation(event);
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

  const object = event.data?.object || {};
  const atendimentoId = extractAtendimentoId(event);
  if (!atendimentoId) {
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
  applyStripeRefundReconciliation,
  extractAtendimentoId,
  handleStripeWebhookEvent,
  handleTypebotPaymentWebhook,
  isRefundStripeEvent,
  linkOrRecordNativeTypebotPayment
};
