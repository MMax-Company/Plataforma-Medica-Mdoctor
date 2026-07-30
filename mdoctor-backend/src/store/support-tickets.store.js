const T = require('../db/tables');
const { dbQuery } = require('../db/persistence');

function normalizePhone(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function ticketPhone(ticket = {}) {
  return normalizePhone(ticket.metadata?.patient_phone || ticket.metadata?.phone || '');
}

function ticketSubStatus(ticket = {}) {
  return String(ticket.metadata?.support_sub_status || 'waiting');
}

async function listSupportTickets({ status = null } = {}) {
  return dbQuery('listar tickets de suporte', async (supabase) => {
    let query = supabase.from(T.SUPPORT_TICKETS).select('*').order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    return query;
  });
}

async function getSupportTicket(id) {
  if (!id) return null;
  return dbQuery('buscar ticket de suporte', async (supabase) =>
    supabase.from(T.SUPPORT_TICKETS).select('*').eq('id', id).maybeSingle()
  );
}

async function findOpenSupportTicketByPhone(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  const rows = await listSupportTickets({ status: 'open' });
  return (rows || []).find((ticket) => ticketPhone(ticket) === digits) || null;
}

async function findSupportTicketByIdempotencyKey(idempotencyKey) {
  const key = String(idempotencyKey || '').trim();
  if (!key) return null;
  const rows = await listSupportTickets();
  return (rows || []).find((ticket) => String(ticket.metadata?.idempotency_key || '').trim() === key) || null;
}

async function createSupportTicket({
  patientId,
  appointmentId = null,
  phone,
  subject,
  metadata = {}
}) {
  const digits = normalizePhone(phone);
  return dbQuery('criar ticket de suporte', async (supabase) =>
    supabase
      .from(T.SUPPORT_TICKETS)
      .insert({
        patient_id: patientId,
        appointment_id: appointmentId || null,
        channel: 'whatsapp',
        status: 'open',
        subject: subject || 'Suporte via WhatsApp',
        metadata: {
          ...metadata,
          patient_phone: digits,
          support_sub_status: metadata.support_sub_status || 'waiting'
        }
      })
      .select('*')
      .single()
  );
}

async function updateSupportTicket(id, { status, metadata = {}, closedAt } = {}) {
  const current = await getSupportTicket(id);
  if (!current) return null;
  const now = new Date().toISOString();
  const patch = {
    metadata: { ...(current.metadata || {}), ...metadata },
    updated_at: now
  };
  if (status) patch.status = status;
  if (closedAt !== undefined) patch.closed_at = closedAt;
  if (status === 'closed' && closedAt === undefined) patch.closed_at = now;

  return dbQuery('atualizar ticket de suporte', async (supabase) =>
    supabase.from(T.SUPPORT_TICKETS).update(patch).eq('id', id).select('*').single()
  );
}

async function recordSupportMessage({
  ticketId,
  direction,
  body,
  providerMessageId = null,
  metadata = {}
}) {
  if (!ticketId || !String(body || '').trim()) return null;
  return dbQuery('registrar mensagem do ticket de suporte', async (supabase) =>
    supabase
      .from(T.SUPPORT_MESSAGES)
      .insert({
        ticket_id: ticketId,
        direction,
        body: String(body),
        provider_message_id: providerMessageId,
        metadata
      })
      .select('*')
      .single()
  );
}

module.exports = {
  ticketPhone,
  ticketSubStatus,
  listSupportTickets,
  getSupportTicket,
  findOpenSupportTicketByPhone,
  findSupportTicketByIdempotencyKey,
  createSupportTicket,
  updateSupportTicket,
  recordSupportMessage
};
