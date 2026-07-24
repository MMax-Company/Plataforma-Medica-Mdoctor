const crypto = require('crypto');
const T = require('../db/tables');
const { dbQuery } = require('../db/persistence');
const { upsertSessionIdentity } = require('../store/whatsapp-sessions.store');
const { createIntegrationError } = require('../store/integration-logs.store');
const { recordStripePaymentEvent, deletePaymentEvent } = require('../store/payments.store');
const metaProvider = require('./providers/meta.provider');
const {
  PAYMENT_AMOUNT_CENTS,
  PAYMENT_AMOUNT_LABEL,
  PAYMENT_BUTTON_LABEL,
  PAYMENT_CANCELLED_MESSAGE,
  PAYMENT_FAILED_MESSAGE,
  PAYMENT_INPUT_ID,
  PAYMENT_PENDING_CHOICES,
  PAYMENT_PENDING_MESSAGE,
  PRE_PAYMENT_MESSAGE
} = require('./typebot-payment.constants');

const TOKEN_TTL_MS = Number(process.env.TYPEBOT_PAYMENT_LINK_TTL_MS || 24 * 60 * 60 * 1000);
const PAYMENT_SUCCESS_REPLY = 'Success';

// Reentrega do MESMO event.id do Stripe (inclusive concorrente) precisa
// falhar a reivindicação em payment_events, não travar o webhook.
function isUniqueViolationError(error) {
  const code = error?.cause?.code || error?.code;
  if (code === '23505') return true;
  const message = String(error?.cause?.message || error?.message || '');
  return /duplicate key value violates unique constraint/i.test(message);
}

function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function getPublicBaseUrl() {
  const base = String(process.env.PUBLIC_BASE_URL || process.env.BASE_URL || '').trim();
  if (base) return base.replace(/\/$/, '');
  const port = process.env.PORT || 3004;
  return `http://localhost:${port}`;
}

function buildCheckoutRedirectUrl(token) {
  return `${getPublicBaseUrl()}/api/typebot-payment/${encodeURIComponent(token)}/checkout`;
}

function buildPaymentPageUrl(token) {
  return `${getPublicBaseUrl()}/api/typebot-payment/${encodeURIComponent(token)}`;
}

function extractIntentId(clientSecret) {
  const match = String(clientSecret || '').match(/^(pi_[A-Za-z0-9]+)_secret_/);
  return match ? match[1] : null;
}

function getStripe() {
  const secretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!secretKey) return null;
  // eslint-disable-next-line global-require
  return require('stripe')(secretKey);
}

function normalizePaymentRecord(payment = {}) {
  const paymentStatus = payment.payment_status || (payment.status === 'completed' ? 'paid' : 'pending');
  return {
    ...payment,
    payment_status: paymentStatus,
    status: paymentStatus === 'paid' ? 'completed' : 'pending',
    amount_cents: payment.amount_cents || PAYMENT_AMOUNT_CENTS,
    amount_label: payment.amount_label || PAYMENT_AMOUNT_LABEL
  };
}

function paymentFromSession(session) {
  const raw = session?.metadata?.typebot_payment;
  if (!raw) return null;
  return normalizePaymentRecord(raw);
}

async function persistPaymentRecord(session, patch) {
  const current = paymentFromSession(session) || {};
  const next = normalizePaymentRecord({ ...current, ...patch });
  await upsertSessionIdentity({
    phone: session.phone,
    bsuid: session.bsuid,
    parentBsuid: session.parentBsuid,
    username: session.username,
    metadataPatch: { typebot_payment: next }
  });
  return next;
}

async function createCheckoutSession(stripe, { token, typebotSessionId, identity }) {
  const successUrl = `${buildPaymentPageUrl(token)}?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${buildPaymentPageUrl(token)}?cancelled=1`;
  return stripe.checkout.sessions.create({
    mode: 'payment',
    locale: 'pt-BR',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'brl',
        unit_amount: PAYMENT_AMOUNT_CENTS,
        product_data: {
          name: 'Consulta médica — Doctor Prescreve',
          description: 'Renovação de receita — avaliação médica'
        }
      }
    }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      payment_token: token,
      typebot_session_id: String(typebotSessionId || ''),
      whatsapp_phone: String(identity?.phone || '')
    }
  });
}

async function createPaymentLinkForSession({ identity, typebotSessionId, runtimeOptions = {}, existingSession = null }) {
  const stripe = getStripe();
  if (!stripe) {
    throw Object.assign(new Error('STRIPE_SECRET_KEY não configurada'), { code: 'STRIPE_NOT_CONFIGURED' });
  }

  const existing = paymentFromSession(existingSession);
  if (existing?.payment_status === 'paid' || existing?.status === 'completed') {
    return { alreadyPaid: true, token: existing.token };
  }

  const now = Date.now();
  const token = existing?.token || generateToken();
  let checkoutSessionId = existing?.checkout_session_id || null;
  let checkoutUrl = existing?.checkout_url || null;

  if (checkoutSessionId) {
    try {
      const current = await stripe.checkout.sessions.retrieve(checkoutSessionId);
      // FASE 4B: só payment_status=paid confirma; status=complete sozinho não basta.
      if (stripeSessionIsPaid(current)) {
        return { alreadyPaid: true, token, checkoutSessionId };
      }
      if (current.status === 'open' && current.url) {
        checkoutUrl = current.url;
      } else {
        checkoutSessionId = null;
        checkoutUrl = null;
      }
    } catch (_) {
      checkoutSessionId = null;
      checkoutUrl = null;
    }
  }

  if (!checkoutSessionId) {
    const created = await createCheckoutSession(stripe, { token, typebotSessionId, identity });
    checkoutSessionId = created.id;
    checkoutUrl = created.url;
  }

  // FASE 4B: WhatsApp usa somente Checkout Session. Não vincular PaymentIntent
  // do bloco payment input do Typebot (runtimeOptions.paymentIntentSecret).
  const record = normalizePaymentRecord({
    token,
    payment_status: 'pending',
    status: 'pending',
    checkout_session_id: checkoutSessionId,
    checkout_url: checkoutUrl,
    intent_id: existing?.intent_id || null,
    typebot_session_id: typebotSessionId,
    amount_cents: PAYMENT_AMOUNT_CENTS,
    amount_label: PAYMENT_AMOUNT_LABEL,
    created_at: existing?.created_at || new Date(now).toISOString(),
    expires_at: new Date(now + TOKEN_TTL_MS).toISOString()
  });

  await upsertSessionIdentity({
    phone: identity?.phone,
    bsuid: identity?.bsuid,
    parentBsuid: identity?.parentBsuid,
    username: identity?.username,
    metadataPatch: { typebot_payment: record }
  });

  return {
    token,
    checkoutUrl,
    checkoutRedirectUrl: buildCheckoutRedirectUrl(token),
    amountLabel: PAYMENT_AMOUNT_LABEL,
    paymentStatus: 'pending'
  };
}

async function findSessionByPaymentToken(token) {
  const normalized = String(token || '').trim();
  if (!normalized) return null;
  return dbQuery('buscar sessão por token de pagamento typebot', async (supabase) =>
    supabase
      .from(T.WHATSAPP_SESSIONS)
      .select('*')
      .filter('metadata->typebot_payment->>token', 'eq', normalized)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  );
}

async function findSessionByPaymentIntentId(intentId) {
  const normalized = String(intentId || '').trim();
  if (!normalized) return null;
  return dbQuery('buscar sessão por intent de pagamento typebot', async (supabase) =>
    supabase
      .from(T.WHATSAPP_SESSIONS)
      .select('*')
      .filter('metadata->typebot_payment->>intent_id', 'eq', normalized)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  );
}

async function findSessionByCheckoutSessionId(checkoutSessionId) {
  const normalized = String(checkoutSessionId || '').trim();
  if (!normalized) return null;
  return dbQuery('buscar sessão por checkout session typebot', async (supabase) =>
    supabase
      .from(T.WHATSAPP_SESSIONS)
      .select('*')
      .filter('metadata->typebot_payment->>checkout_session_id', 'eq', normalized)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  );
}

function paymentStateFromSession(session) {
  const payment = paymentFromSession(session);
  if (!payment) return null;
  const expired = payment.expires_at ? Date.parse(payment.expires_at) < Date.now() : false;
  return { payment, expired };
}

async function resolveCheckoutRedirect(token, deps = {}) {
  const retrieveSession = deps.findSessionByPaymentToken || findSessionByPaymentToken;
  const stripeClient = deps.stripe || getStripe();
  const session = await retrieveSession(token);
  const state = paymentStateFromSession(session);
  if (!state) return { ok: false, code: 'NOT_FOUND' };
  if (state.expired) return { ok: false, code: 'EXPIRED' };
  if (state.payment.payment_status === 'paid') return { ok: false, code: 'ALREADY_PAID' };

  if (!stripeClient) return { ok: false, code: 'STRIPE_NOT_CONFIGURED' };

  let checkoutSessionId = state.payment.checkout_session_id;
  let checkoutUrl = state.payment.checkout_url;
  if (checkoutSessionId) {
    const current = await stripeClient.checkout.sessions.retrieve(checkoutSessionId);
    if (stripeSessionIsPaid(current)) {
      return { ok: false, code: 'ALREADY_PAID' };
    }
    if (current.status === 'open' && current.url) {
      return { ok: true, url: current.url };
    }
    checkoutSessionId = null;
  }

  const created = await createCheckoutSession(stripeClient, {
    token,
    typebotSessionId: state.payment.typebot_session_id,
    identity: { phone: session.phone }
  });
  await persistPaymentRecord(session, {
    checkout_session_id: created.id,
    checkout_url: created.url,
    payment_status: 'pending'
  });
  return { ok: true, url: created.url };
}

async function getPaymentConfigByToken(token) {
  const session = await findSessionByPaymentToken(token);
  const state = paymentStateFromSession(session);
  if (!state) return { found: false };
  const { payment, expired } = state;
  return {
    found: true,
    expired,
    paymentStatus: payment.payment_status,
    amountLabel: payment.amount_label,
    checkoutUrl: payment.checkout_url || null
  };
}

async function claimPaymentFlowResume(session, patch) {
  const current = paymentFromSession(session);
  if (current?.flow_resumed) return false;
  const metadata = {
    ...(session.metadata || {}),
    typebot_payment: normalizePaymentRecord({ ...current, ...patch, flow_resumed: true })
  };
  const rows = await dbQuery('retomar fluxo após pagamento typebot', async (supabase) =>
    supabase
      .from(T.WHATSAPP_SESSIONS)
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq('id', session.id)
      .or('metadata->typebot_payment->>flow_resumed.is.null,metadata->typebot_payment->>flow_resumed.eq.false')
      .select('id')
  );
  return Array.isArray(rows) && rows.length === 1;
}

async function revertPaymentToPending(session) {
  await persistPaymentRecord(session, { payment_status: 'pending', status: 'pending' });
}

async function markPaymentStatus(session, paymentStatus, extra = {}) {
  await persistPaymentRecord(session, { payment_status: paymentStatus, ...extra });
}

/**
 * FASE 4B — confirmação só com prova Stripe:
 * payment_status=paid + valor + moeda BRL.
 * status=complete sem payment_status=paid NÃO confirma.
 */
function stripeSessionIsPaid(stripeSession = {}) {
  if (String(stripeSession.payment_status || '').toLowerCase() !== 'paid') return false;
  if (Number(stripeSession.amount_total) !== PAYMENT_AMOUNT_CENTS) return false;
  const currency = String(stripeSession.currency || 'brl').toLowerCase();
  if (currency !== 'brl') return false;
  return true;
}

async function verifyStripeCheckoutPaid(payment, deps = {}) {
  const stripeClient = deps.stripe || getStripe();
  if (!stripeClient || !payment?.checkout_session_id) return { paid: false, reason: 'missing_checkout' };
  const checkout = await stripeClient.checkout.sessions.retrieve(payment.checkout_session_id);
  if (!stripeSessionIsPaid(checkout)) {
    if (checkout.status === 'expired') return { paid: false, reason: 'expired', checkout };
    if (checkout.status === 'complete' && checkout.payment_status !== 'paid') {
      return { paid: false, reason: 'complete_without_paid', checkout };
    }
    return { paid: false, reason: 'not_paid', checkout };
  }
  return { paid: true, checkout };
}

/**
 * Confirma pagamento WhatsApp apenas com Checkout Stripe da mesma sessão/token.
 * payment_status="paid" vindo do Typebot NÃO confirma.
 */
async function resolveConfirmedWhatsAppPayment({ phone = null, paymentToken = null, deps = {} } = {}) {
  const findByToken = deps.findSessionByPaymentToken || findSessionByPaymentToken;
  const verify = deps.verifyStripeCheckoutPaid || verifyStripeCheckoutPaid;

  let session = null;
  const token = String(paymentToken || '').trim();
  if (token) session = await findByToken(token);
  if (!session && phone) {
    // eslint-disable-next-line global-require
    const getByPhone = deps.getSessionByPhone || require('../store/whatsapp-sessions.store').getSessionByPhone;
    session = await getByPhone(phone);
  }

  const payment = paymentFromSession(session);
  if (!payment?.token || !payment?.checkout_session_id) {
    return { confirmed: false, reason: 'missing_payment_record', payment: null, session };
  }

  // Sessão já marcada paid pelo webhook Stripe assinado (com event id) — aceitar
  // se a consulta Stripe confirmar, ou se o client Stripe não estiver disponível
  // mas houver stripe_event_id (prova de que veio do webhook).
  const verified = await verify(payment, deps);
  if (verified.paid) {
    return {
      confirmed: true,
      reason: 'stripe_checkout_paid',
      payment_token: payment.token,
      checkout_session_id: verified.checkout?.id || payment.checkout_session_id,
      payment,
      session,
      checkout: verified.checkout || null
    };
  }

  if (
    payment.payment_status === 'paid'
    && payment.stripe_event_id
    && verified.reason === 'missing_checkout'
  ) {
    // Stripe client ausente em ambiente de teste; webhook já validou amount/paid.
    return {
      confirmed: true,
      reason: 'webhook_marked_paid',
      payment_token: payment.token,
      checkout_session_id: payment.checkout_session_id,
      payment,
      session,
      checkout: null
    };
  }

  return {
    confirmed: false,
    reason: verified.reason || 'not_paid',
    payment_token: payment.token,
    checkout_session_id: payment.checkout_session_id,
    payment,
    session,
    checkout: verified.checkout || null
  };
}

async function refreshPaymentStatus(token, deps = {}) {
  const session = deps.session || (await findSessionByPaymentToken(token));
  const state = paymentStateFromSession(session);
  if (!state) return { ok: false, code: 'NOT_FOUND' };
  const { payment, expired } = state;
  if (payment.payment_status === 'paid') return { ok: true, paymentStatus: 'paid', alreadyPaid: true };
  if (expired) return { ok: false, code: 'EXPIRED', paymentStatus: payment.payment_status };

  const verified = await verifyStripeCheckoutPaid(payment, deps);
  if (verified.paid) {
    await markPaymentStatus(session, 'paid', {
      status: 'completed',
      paid_at: new Date().toISOString(),
      stripe_checkout_session_id: verified.checkout.id
    });
    return { ok: true, paymentStatus: 'paid', justPaid: true, session };
  }
  if (verified.reason === 'expired') {
    await markPaymentStatus(session, 'failed');
    return { ok: true, paymentStatus: 'failed', session };
  }
  return { ok: true, paymentStatus: 'pending', session };
}

async function applyCheckoutWebhook(event, deps = {}) {
  const object = event?.data?.object || {};
  const token = String(object.metadata?.payment_token || '').trim();
  const findByToken = deps.findSessionByPaymentToken || findSessionByPaymentToken;
  const findByCheckout = deps.findSessionByCheckoutSessionId || findSessionByCheckoutSessionId;
  let session = token ? await findByToken(token) : null;
  if (!session && object.id) session = await findByCheckout(object.id);
  if (!session) return { ok: false, code: 'SESSION_NOT_FOUND' };

  const payment = paymentFromSession(session);
  if (payment.payment_status === 'paid') {
    return { ok: true, alreadyPaid: true, token: payment.token, session };
  }
  if (!stripeSessionIsPaid(object)) {
    if (object.status === 'complete' && object.payment_status !== 'paid') {
      return { ok: false, code: 'COMPLETE_WITHOUT_PAID' };
    }
    if (Number(object.amount_total) !== PAYMENT_AMOUNT_CENTS) {
      return { ok: false, code: 'INVALID_AMOUNT' };
    }
    const currency = String(object.currency || '').toLowerCase();
    if (currency && currency !== 'brl') {
      return { ok: false, code: 'INVALID_CURRENCY' };
    }
    return { ok: false, code: 'NOT_PAID' };
  }

  // Idempotência da retomada por reentrega do MESMO evento Stripe (mesma
  // proteção do canal painel/Memed: payment_events.provider_event_id, índice
  // único parcial — supabase/migrations/20260602_fechamento_stripe_payments_
  // idempotency.sql). Reivindica o event.id ANTES de marcar o pagamento: a
  // reivindicação em si é atômica no banco (constraint única), então mesmo
  // duas entregas concorrentes só deixam uma passar, sem depender de timing.
  const recordEvent = deps.recordStripePaymentEvent || recordStripePaymentEvent;
  let claim;
  try {
    claim = await recordEvent({
      appointmentId: null,
      patientId: null,
      providerEventId: event.id,
      eventType: event.type,
      amountCents: object.amount_total || null,
      currency: String(object.currency || 'brl').toUpperCase(),
      payload: { channel: 'whatsapp', checkout_session_id: object.id, payment_token: token, phone: session.phone || null }
    });
  } catch (error) {
    if (!isUniqueViolationError(error)) throw error;
    claim = { duplicate: true };
  }
  if (claim.duplicate) {
    return { ok: true, alreadyPaid: true, token: payment.token, session };
  }

  const markStatus = deps.markPaymentStatus || markPaymentStatus;
  try {
    await markStatus(session, 'paid', {
      status: 'completed',
      paid_at: new Date().toISOString(),
      checkout_session_id: object.id,
      stripe_event_id: event.id
    });
  } catch (error) {
    // Falha antes da retomada: desfaz a reivindicação para permitir nova
    // tentativa segura na próxima reentrega do mesmo evento.
    const revertClaim = deps.deletePaymentEvent || deletePaymentEvent;
    await revertClaim(claim.paymentEvent?.id, claim.payment?.id).catch(() => {});
    throw error;
  }
  return { ok: true, token: payment.token, session, justPaid: true };
}

async function sendTypebotOutputs({ session, outputs, correlationId, provider }) {
  const providerMessageIds = [];
  for (const output of outputs) {
    const common = {
      to: session.phone,
      bsuid: session.bsuid,
      correlationId,
      idempotencyKey: `${correlationId}:${providerMessageIds.length}`
    };
    let sent;
    if (output.kind === 'buttons') sent = await provider.sendButtonMessage({ ...common, body: output.body, buttons: output.choices });
    else if (output.kind === 'list') sent = await provider.sendListMessage({ ...common, body: output.body, button: output.button, rows: output.choices });
    else if (output.kind === 'cta_url') sent = await provider.sendCtaUrlMessage({ ...common, body: output.body, displayText: output.displayText, url: output.url });
    else sent = await provider.sendTextMessage({ ...common, text: output.text });
    if (sent?.providerMessageId) providerMessageIds.push(sent.providerMessageId);
  }
  return providerMessageIds;
}

async function sendPaymentIntro({ session, checkoutRedirectUrl, correlationId, provider = metaProvider, idempotencyPrefix = correlationId }) {
  return sendTypebotOutputs({
    session,
    correlationId,
    provider,
    outputs: [
      { kind: 'text', text: PRE_PAYMENT_MESSAGE },
      {
        kind: 'cta_url',
        body: 'Toque no botão abaixo para concluir o pagamento com segurança.',
        displayText: PAYMENT_BUTTON_LABEL,
        url: checkoutRedirectUrl
      }
    ]
  });
}

async function sendPaymentPendingMenu({ session, correlationId, provider = metaProvider }) {
  return sendTypebotOutputs({
    session,
    correlationId,
    provider,
    outputs: [
      { kind: 'text', text: PAYMENT_PENDING_MESSAGE },
      { kind: 'buttons', body: 'Escolha uma opção:', choices: PAYMENT_PENDING_CHOICES }
    ]
  });
}

async function completePaymentByToken(token, deps = {}) {
  // eslint-disable-next-line global-require
  const bridge = require('./typebot-whatsapp.bridge');
  const callTypebot = deps.callTypebot || bridge.fetchTypebot;
  const convertResponse = deps.convertTypebotResponse || bridge.convertTypebotResponse;
  const provider = deps.provider || metaProvider;
  const persistSession = deps.upsertSessionIdentity || upsertSessionIdentity;
  const logError = deps.createIntegrationError || createIntegrationError;
  const claimFlowResume = deps.claimFlowResume || claimPaymentFlowResume;
  const revertFlowResume = deps.revertFlowResume || (async (currentSession) => {
    await persistPaymentRecord(currentSession, { flow_resumed: false });
  });
  const refreshStatus = deps.refreshPaymentStatus || refreshPaymentStatus;

  const session = deps.session || (await findSessionByPaymentToken(token));
  const state = paymentStateFromSession(session);
  if (!state) return { ok: false, code: 'NOT_FOUND' };
  const { payment, expired } = state;

  if (payment.flow_resumed) return { ok: true, alreadyCompleted: true };
  if (expired) return { ok: false, code: 'EXPIRED' };

  const refreshed = await refreshStatus(token, { session, ...deps });
  if (refreshed.paymentStatus !== 'paid') {
    return { ok: false, code: 'NOT_PAID', paymentStatus: refreshed.paymentStatus || 'pending' };
  }

  const claimed = await claimFlowResume(session, {
    payment_status: 'paid',
    status: 'completed',
    paid_at: payment.paid_at || new Date().toISOString()
  });
  if (!claimed) return { ok: true, alreadyCompleted: true };

  const correlationId = `typebot-payment-${payment.checkout_session_id || payment.token}`;
  try {
    const typebot = await callTypebot(
      `/sessions/${encodeURIComponent(payment.typebot_session_id)}/continueChat`,
      { message: { type: 'text', text: PAYMENT_SUCCESS_REPLY, metadata: { replyId: correlationId } } }
    );

    // O Typebot já envia o texto de pagamento confirmado/orientação (grupo
    // "Aguardando envio da receita") — enviar PAYMENT_CONFIRMED_MESSAGE aqui
    // duplicava essa mensagem. Antes de entregar a resposta do Typebot ao
    // paciente, se o próximo passo já for a etapa de upload da receita
    // (decisão do webhook de triagem, não alterada aqui), grava
    // atomicamente o contexto de upload na sessão — fecha a janela em que a
    // mídia podia chegar antes desse estado existir.
    const uploadHelpers = deps.uploadHelpers || require('./typebot-prescription-upload.service');
    if (uploadHelpers.responseLooksLikeUploadStage(typebot, typebot.input?.id)) {
      const uploadContext = await uploadHelpers.findUploadContextForPhone(session.phone);
      if (uploadContext) {
        await uploadHelpers.persistUploadContext({
          identity: { phone: session.phone, bsuid: session.bsuid },
          uploadContext,
          whatsappSession: session
        });
      }
    }

    const providerMessageIds = await sendTypebotOutputs({
      session,
      outputs: convertResponse(typebot),
      correlationId,
      provider
    });
    await persistSession({
      phone: session.phone,
      bsuid: session.bsuid,
      metadataPatch: { typebot_expected_input_id: typebot.input?.id || null }
    }).catch(() => {});
    return { ok: true, responsesSent: providerMessageIds.length };
  } catch (error) {
    await revertFlowResume(session);
    await logError({
      integration: 'typebot_payment_link',
      correlationId,
      error,
      request: { token_suffix: String(token).slice(-8), checkout_session_id: payment.checkout_session_id, phase: 'continue_after_payment' }
    }).catch(() => {});
    throw error;
  }
}

async function handlePaymentChoice({ text, session, correlationId, provider = metaProvider, deps = {} }) {
  const payment = paymentFromSession(session);
  if (!payment) return { handled: false };
  const markStatus = deps.markPaymentStatus || markPaymentStatus;
  const normalized = String(text || '').trim().toLowerCase();
  const isCheck = normalized.includes('conferir pagamento') || normalized === 'payment_check';
  const isReopen = normalized.includes('abrir pagamento') || normalized === 'payment_reopen';
  const isCancel = normalized.includes('cancelar') || normalized === 'payment_cancel';
  if (!isCheck && !isReopen && !isCancel) return { handled: false };

  if (isCancel) {
    await markStatus(session, 'cancelled');
    await provider.sendTextMessage({
      to: session.phone,
      bsuid: session.bsuid,
      correlationId,
      idempotencyKey: `${correlationId}:payment-cancelled`,
      text: PAYMENT_CANCELLED_MESSAGE
    });
    return { handled: true, action: 'cancelled' };
  }

  if (isReopen) {
    if (payment.payment_status === 'paid') {
      await completePaymentByToken(payment.token, { session, provider, ...deps });
      return { handled: true, action: 'already_paid' };
    }
    const link = await createPaymentLinkForSession({
      identity: { phone: session.phone, bsuid: session.bsuid },
      typebotSessionId: payment.typebot_session_id,
      existingSession: session
    });
    await sendPaymentIntro({
      session,
      checkoutRedirectUrl: link.checkoutRedirectUrl,
      correlationId,
      provider,
      idempotencyPrefix: `${correlationId}:reopen`
    });
    return { handled: true, action: 'reopened' };
  }

  const refreshed = await refreshPaymentStatus(payment.token, { session, ...deps });
  if (refreshed.paymentStatus === 'paid') {
    await completePaymentByToken(payment.token, { session, provider, ...deps });
    return { handled: true, action: 'completed' };
  }
  if (refreshed.paymentStatus === 'failed') {
    await provider.sendTextMessage({
      to: session.phone,
      bsuid: session.bsuid,
      correlationId,
      idempotencyKey: `${correlationId}:payment-failed`,
      text: PAYMENT_FAILED_MESSAGE
    });
    await sendPaymentPendingMenu({ session, correlationId, provider });
    return { handled: true, action: 'failed' };
  }
  await sendPaymentPendingMenu({ session, correlationId, provider });
  return { handled: true, action: 'pending' };
}

function isPaymentStageInput(inputId) {
  return String(inputId || '').trim() === PAYMENT_INPUT_ID;
}

function sessionHasPendingPayment(session) {
  const payment = paymentFromSession(session);
  if (!payment) return false;
  return ['pending', 'failed', 'cancelled'].includes(payment.payment_status);
}

module.exports = {
  PAYMENT_SUCCESS_REPLY,
  applyCheckoutWebhook,
  buildCheckoutRedirectUrl,
  buildPaymentPageUrl,
  completePaymentByToken,
  createPaymentLinkForSession,
  extractIntentId,
  findSessionByCheckoutSessionId,
  findSessionByPaymentIntentId,
  findSessionByPaymentToken,
  getPaymentConfigByToken,
  handlePaymentChoice,
  isPaymentStageInput,
  paymentFromSession,
  refreshPaymentStatus,
  resolveCheckoutRedirect,
  resolveConfirmedWhatsAppPayment,
  sendPaymentIntro,
  sendPaymentPendingMenu,
  sessionHasPendingPayment,
  stripeSessionIsPaid,
  verifyStripeCheckoutPaid
};
