const crypto = require('crypto');
const T = require('../db/tables');
const { dbQuery } = require('../db/persistence');
const { upsertSessionIdentity } = require('../store/whatsapp-sessions.store');
const { createIntegrationError } = require('../store/integration-logs.store');
const metaProvider = require('./providers/meta.provider');

const TOKEN_TTL_MS = Number(process.env.TYPEBOT_PAYMENT_LINK_TTL_MS || 24 * 60 * 60 * 1000);
// Resposta que o bot-engine espera para avançar um "payment input" via chat API.
// O runtime do Typebot NÃO valida o pagamento server-side — a verificação real
// contra o Stripe é feita aqui (completePaymentByToken) antes de enviá-la.
const PAYMENT_SUCCESS_REPLY = 'Success';

function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function getPublicBaseUrl() {
  const base = String(process.env.PUBLIC_BASE_URL || process.env.BASE_URL || '').trim();
  if (base) return base.replace(/\/$/, '');
  const port = process.env.PORT || 3004;
  return `http://localhost:${port}`;
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

async function createPaymentLinkForSession({ identity, typebotSessionId, runtimeOptions = {} }) {
  const clientSecret = runtimeOptions.paymentIntentSecret;
  const intentId = extractIntentId(clientSecret);
  if (!clientSecret || !intentId) {
    throw Object.assign(new Error('payment input sem paymentIntentSecret válido'), { code: 'TYPEBOT_PAYMENT_NO_INTENT' });
  }
  if (!runtimeOptions.publicKey) {
    throw Object.assign(new Error('payment input sem publicKey'), { code: 'TYPEBOT_PAYMENT_NO_PUBLIC_KEY' });
  }

  const now = Date.now();
  const record = {
    token: generateToken(),
    status: 'pending',
    intent_id: intentId,
    client_secret: clientSecret,
    public_key: runtimeOptions.publicKey,
    amount_label: runtimeOptions.amountLabel || null,
    typebot_session_id: typebotSessionId,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + TOKEN_TTL_MS).toISOString()
  };

  await upsertSessionIdentity({
    phone: identity?.phone,
    bsuid: identity?.bsuid,
    parentBsuid: identity?.parentBsuid,
    username: identity?.username,
    metadataPatch: { typebot_payment: record }
  });

  return { token: record.token, url: buildPaymentPageUrl(record.token), amountLabel: record.amount_label };
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

function paymentStateFromSession(session) {
  const payment = session?.metadata?.typebot_payment;
  if (!payment) return null;
  const expired = payment.expires_at ? Date.parse(payment.expires_at) < Date.now() : false;
  return { payment, expired };
}

async function getPaymentConfigByToken(token) {
  const session = await findSessionByPaymentToken(token);
  const state = paymentStateFromSession(session);
  if (!state) return { found: false };
  const { payment, expired } = state;
  return {
    found: true,
    expired,
    status: payment.status,
    amountLabel: payment.amount_label,
    publicKey: payment.public_key,
    clientSecret: payment.status === 'pending' && !expired ? payment.client_secret : null
  };
}

async function claimPaymentCompletion(session, patch) {
  const metadata = {
    ...(session.metadata || {}),
    typebot_payment: { ...session.metadata.typebot_payment, ...patch }
  };
  const rows = await dbQuery('transicionar pagamento typebot', async (supabase) =>
    supabase
      .from(T.WHATSAPP_SESSIONS)
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq('id', session.id)
      .filter('metadata->typebot_payment->>status', 'eq', 'pending')
      .select('id')
  );
  return Array.isArray(rows) && rows.length === 1;
}

async function revertPaymentToPending(session) {
  const metadata = {
    ...(session.metadata || {}),
    typebot_payment: { ...session.metadata.typebot_payment, status: 'pending' }
  };
  await dbQuery('reverter pagamento typebot para pending', async (supabase) =>
    supabase
      .from(T.WHATSAPP_SESSIONS)
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq('id', session.id)
  ).catch(() => {});
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
    else sent = await provider.sendTextMessage({ ...common, text: output.text });
    if (sent?.providerMessageId) providerMessageIds.push(sent.providerMessageId);
  }
  return providerMessageIds;
}

async function completePaymentByToken(token, deps = {}) {
  // Lazy require para evitar ciclo bridge <-> service.
  // eslint-disable-next-line global-require
  const bridge = require('./typebot-whatsapp.bridge');
  const callTypebot = deps.callTypebot || bridge.fetchTypebot;
  const convertResponse = deps.convertTypebotResponse || bridge.convertTypebotResponse;
  const provider = deps.provider || metaProvider;
  const retrieveIntent = deps.retrieveIntent || (async (intentId) => {
    const stripe = getStripe();
    if (!stripe) throw Object.assign(new Error('STRIPE_SECRET_KEY não configurada'), { code: 'STRIPE_NOT_CONFIGURED' });
    return stripe.paymentIntents.retrieve(intentId);
  });
  const persistSession = deps.upsertSessionIdentity || upsertSessionIdentity;
  const logError = deps.createIntegrationError || createIntegrationError;
  const claimCompletion = deps.claimCompletion || claimPaymentCompletion;
  const revertToPending = deps.revertToPending || revertPaymentToPending;

  const session = deps.session || (await findSessionByPaymentToken(token));
  const state = paymentStateFromSession(session);
  if (!state) return { ok: false, code: 'NOT_FOUND' };
  const { payment, expired } = state;

  if (payment.status === 'completed') return { ok: true, alreadyCompleted: true };
  if (expired) return { ok: false, code: 'EXPIRED' };

  const intent = await retrieveIntent(payment.intent_id);
  if (intent?.status !== 'succeeded') {
    return { ok: false, code: 'NOT_PAID', intentStatus: intent?.status || 'unknown' };
  }

  const claimed = await claimCompletion(session, {
    status: 'completed',
    completed_at: new Date().toISOString()
  });
  if (!claimed) return { ok: true, alreadyCompleted: true };

  const correlationId = `typebot-payment-${payment.intent_id}`;
  try {
    const typebot = await callTypebot(
      `/sessions/${encodeURIComponent(payment.typebot_session_id)}/continueChat`,
      { message: { type: 'text', text: PAYMENT_SUCCESS_REPLY, metadata: { replyId: correlationId } } }
    );
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
    await revertToPending(session);
    await logError({
      integration: 'typebot_payment_link',
      correlationId,
      error,
      request: { token_suffix: String(token).slice(-8), intent_id: payment.intent_id, phase: 'continue_after_payment' }
    }).catch(() => {});
    throw error;
  }
}

module.exports = {
  PAYMENT_SUCCESS_REPLY,
  buildPaymentPageUrl,
  completePaymentByToken,
  createPaymentLinkForSession,
  extractIntentId,
  findSessionByPaymentToken,
  getPaymentConfigByToken
};
