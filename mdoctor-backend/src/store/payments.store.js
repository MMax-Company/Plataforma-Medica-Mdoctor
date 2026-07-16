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

async function markPaymentRefunded(paymentId) {
  if (!paymentId) return null;
  const data = await dbQuery('marcar payment como refunded', async (supabase) =>
    supabase.from(T.PAYMENTS).update({ status: 'refunded' }).eq('id', paymentId).select('*').maybeSingle()
  );
  return data || null;
}

module.exports = {
  findPaymentEventByProviderId,
  findPaymentByAppointment,
  markPaymentRefunded,
  recordStripePaymentEvent
};
