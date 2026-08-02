const { randomUUID } = require('crypto');
const T = require('../db/tables');
const { dbQuery } = require('../db/persistence');

async function findPaymentEventByProviderId(_provider, providerEventId) {
  if (!providerEventId) return null;
  const data = await dbQuery('buscar payment_event', async (supabase) =>
    supabase
      .from(T.PAYMENT_EVENTS)
      .select('*, payments(*)')
      .eq('provider_event_id', providerEventId)
      .maybeSingle()
  );
  return data || null;
}

async function recordStripePaymentEvent({
  appointmentId,
  patientId = null,
  providerEventId,
  eventType,
  amountCents = null,
  currency = 'BRL',
  payload = {}
}) {
  if (providerEventId) {
    const existing = await findPaymentEventByProviderId('stripe', providerEventId);
    if (existing) {
      return { duplicate: true, payment: existing.payments, paymentEvent: existing };
    }
  }

  const paymentRow = {
    id: randomUUID(),
    appointment_id: appointmentId,
    patient_id: patientId,
    provider: 'stripe',
    external_id: payload.session_id || payload.payment_intent || providerEventId,
    amount_cents: amountCents,
    currency,
    status: 'paid',
    metadata: payload,
    paid_at: new Date().toISOString()
  };

  const payment = await dbQuery('criar payment', async (supabase) =>
    supabase.from(T.PAYMENTS).insert(paymentRow).select('*').single()
  );

  const paymentEvent = await dbQuery('criar payment_event', async (supabase) =>
    supabase
      .from(T.PAYMENT_EVENTS)
      .insert({
        payment_id: payment.id,
        event_type: eventType || 'checkout.session.completed',
        provider_event_id: providerEventId,
        payload
      })
      .select('*')
      .single()
  );

  return { duplicate: false, payment, paymentEvent };
}

async function findPaymentByAppointment(appointmentId) {
  if (!appointmentId) return null;
  const data = await dbQuery('buscar payment por appointment', async (supabase) =>
    supabase
      .from(T.PAYMENTS)
      .select('*')
      .eq('appointment_id', appointmentId)
      .order('paid_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  );
  return data || null;
}

async function deletePaymentEvent(paymentEventId, paymentId) {
  if (paymentEventId) {
    await dbQuery('reverter payment_event (nova tentativa segura)', async (supabase) =>
      supabase.from(T.PAYMENT_EVENTS).delete().eq('id', paymentEventId)
    );
  }
  if (paymentId) {
    await dbQuery('reverter payment (nova tentativa segura)', async (supabase) =>
      supabase.from(T.PAYMENTS).delete().eq('id', paymentId)
    );
  }
}

async function markPaymentRefunded(paymentId) {
  if (!paymentId) return null;
  const data = await dbQuery('marcar payment como refunded', async (supabase) =>
    supabase.from(T.PAYMENTS).update({ status: 'refunded' }).eq('id', paymentId).select('*').maybeSingle()
  );
  return data || null;
}

// Bloco de pagamento nativo do Typebot (Stripe conectado direto no bot) cria
// o PaymentIntent sem metadata e sem atendimento_id (atendimento ainda nem
// existe nesse instante) — o único identificador do paciente que sobrevive
// no PaymentIntent é receipt_email (confirmado direto na Stripe real em
// 02/08/2026: metadata sempre {}, shipping sempre null). Achado real: o
// primeiro estorno automático de reprovação não encontrou o pagamento por
// falta desse vínculo. Este registro fica "órfão" (appointment_id null,
// já suportado por recordStripePaymentEvent) até processTriagemWebhook
// resolver o atendimento recém-criado pelo mesmo e-mail/valor/moeda.
async function findUnlinkedNativePaymentByEmail({ email, amountCents, currency = 'BRL', sinceIso = null }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !amountCents) return null;
  const data = await dbQuery('buscar payment orfao do bloco nativo Typebot por email', async (supabase) => {
    let query = supabase
      .from(T.PAYMENTS)
      .select('*')
      .is('appointment_id', null)
      .eq('amount_cents', amountCents)
      .eq('currency', String(currency || 'BRL').toUpperCase())
      .filter('metadata->>receipt_email', 'eq', normalizedEmail)
      .order('paid_at', { ascending: false })
      .limit(1);
    if (sinceIso) query = query.gte('paid_at', sinceIso);
    return query.maybeSingle();
  });
  return data || null;
}

async function linkPaymentToAppointment(paymentId, appointmentId, patientId = null) {
  if (!paymentId || !appointmentId) return null;
  const patch = { appointment_id: appointmentId };
  if (patientId) patch.patient_id = patientId;
  const data = await dbQuery('vincular payment orfao ao appointment', async (supabase) =>
    supabase.from(T.PAYMENTS).update(patch).eq('id', paymentId).select('*').maybeSingle()
  );
  return data || null;
}

module.exports = {
  deletePaymentEvent,
  findPaymentEventByProviderId,
  findPaymentByAppointment,
  findUnlinkedNativePaymentByEmail,
  linkPaymentToAppointment,
  markPaymentRefunded,
  recordStripePaymentEvent
};
