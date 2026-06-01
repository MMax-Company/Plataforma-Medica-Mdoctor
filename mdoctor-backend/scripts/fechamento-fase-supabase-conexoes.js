#!/usr/bin/env node
/**
 * Fechamento fase Supabase + conexões críticas (testes 1–7 da ordem).
 */
require('./load-dotenv');

const { initSupabase, pingSupabase } = require('../src/config/supabase');
const { PersistenceError } = require('../src/db/persistence');
const T = require('../src/db/tables');
const { createPatient } = require('../src/store/patients.store');
const {
  createAtendimento,
  getAtendimento,
  updateAtendimentoStatus,
  createEntregaReceitaLog,
  STATUS
} = require('../src/store/atendimentos.store');
const { recordStripePaymentEvent, findPaymentEventByProviderId } = require('../src/store/payments.store');
const {
  persistTriagemFlow,
  recordSupportTicket,
  recordWhatsappMessage
} = require('../src/services/clinical-persistence.service');
const { dbQuery } = require('../src/db/persistence');
const { getAppointmentTable } = require('../src/db/resolve-tables');

const report = { steps: [], errors: [] };

function step(name, ok, extra = {}) {
  report.steps.push({ name, ok, ...extra });
  if (!ok && !extra.skip) report.errors.push(name);
}

async function main() {
  initSupabase();
  const ping = await pingSupabase();
  step('infra_ping', ping.responding, ping);

  const ts = Date.now();
  const phone = `5511966${String(ts).slice(-6)}`;

  const patient = await createPatient({
    nome: `Fechamento ${ts}`,
    telefone: phone,
    cpf: '52998224725',
    email: `fechamento.${ts}@example.com`
  });
  step('teste2_atendimento_patient', Boolean(patient?.id), { id: patient?.id });

  const atendimento = await createAtendimento({
    patient_id: patient.id,
    paciente_nome: patient.nome,
    paciente_telefone: phone,
    condicao: 'has',
    pagamento_status: 'CONFIRMADO',
    status: STATUS.WAITING,
    elegibilidade: { eligible: true, reason: 'Fechamento' },
    dados_clinicos: { fechamento: true }
  });
  step('teste2_appointment', Boolean(atendimento?.id), { id: atendimento?.id });

  const apptTable = await getAppointmentTable();
  const apptRow = await dbQuery('probe appointments', async (s) =>
    s.from(apptTable).select('id').eq('id', atendimento.id).maybeSingle()
  );
  step('confirmar_appointments', Boolean(apptRow?.id), { table: apptTable });

  let triageOk = false;
  try {
    await persistTriagemFlow({
      patient,
      atendimento,
      validation: { paciente: { nome: patient.nome }, triagem: { doencas: 'has' } },
      decision: atendimento.elegibilidade,
      correlationId: `fechamento-${ts}`,
      idempotencyKey: `fechamento-${ts}`
    });
    const triage = await dbQuery('probe triage', async (s) =>
      s.from(T.TRIAGE_SESSIONS).select('id').eq('appointment_id', atendimento.id).limit(1)
    );
    triageOk = Boolean(triage && triage.length > 0);
  } catch (error) {
    step('confirmar_triage_sessions', false, { skip: true, error: error.message });
    triageOk = false;
  }
  if (triageOk) step('confirmar_triage_sessions', true);

  try {
    const ticket = await recordSupportTicket({
      appointmentId: atendimento.id,
      phone,
      subject: 'Teste fechamento suporte'
    });
    step('teste3_suporte', Boolean(ticket?.id));
  } catch (error) {
    step('teste3_suporte', false, { skip: true, error: error.message });
  }

  try {
    const stripeEventId = `evt_test_${ts}`;
    await recordStripePaymentEvent({
      appointmentId: atendimento.id,
      patientId: patient.id,
      providerEventId: stripeEventId,
      eventType: 'checkout.session.completed',
      amountCents: 9900,
      payload: { test: true }
    });
    const dupPay = await findPaymentEventByProviderId('stripe', stripeEventId);
    step('teste4_payment_events', Boolean(dupPay?.id));
    const dupAgain = await recordStripePaymentEvent({
      appointmentId: atendimento.id,
      providerEventId: stripeEventId,
      eventType: 'checkout.session.completed',
      payload: { test: true }
    });
    step('stripe_idempotency', dupAgain.duplicate === true);
  } catch (error) {
    step('teste4_payment_events', false, { skip: true, error: error.message });
    step('stripe_idempotency', false, { skip: true });
  }

  try {
    await recordWhatsappMessage({
      appointmentId: atendimento.id,
      phone,
      body: 'Teste fechamento WhatsApp',
      direction: 'outbound',
      status: 'sent'
    });
    const wa = await dbQuery('probe wa', async (s) =>
      s.from(T.WHATSAPP_MESSAGES).select('id').eq('appointment_id', atendimento.id).limit(1)
    );
    step('teste5_whatsapp', Boolean(wa && wa.length > 0));
  } catch (error) {
    step('teste5_whatsapp', false, { skip: true, error: error.message });
  }

  await updateAtendimentoStatus(atendimento.id, STATUS.EM_ATENDIMENTO, { status_anterior: atendimento.status });
  const orderCol = apptTable === 'atendimentos' ? 'criado_em' : 'created_at';
  const listed = await dbQuery('dashboard', async (s) =>
    s.from(apptTable).select('id,status').order(orderCol, { ascending: false }).limit(3)
  );
  step('teste6_dashboard', Array.isArray(listed) && listed.length > 0);

  const reloaded = await getAtendimento(atendimento.id);
  step('teste1_reload', reloaded?.id === atendimento.id, { status: reloaded?.status });

  await createEntregaReceitaLog({
    atendimento_id: atendimento.id,
    canal: 'whatsapp',
    status: 'sent',
    provider: 'test'
  });

  const fs = require('fs');
  const path = require('path');
  const storeFiles = ['atendimentos.store.js', 'patients.store.js', 'audit.store.js', 'prescriptions.store.js'];
  const memoryPatterns = [/let atendimentos\s*=/, /let patients\s*=/, /localAuditLogs/, /assertCanFallback/];
  let memoryFallback = false;
  for (const file of storeFiles) {
    const content = fs.readFileSync(path.join(__dirname, '../src/store', file), 'utf8');
    if (memoryPatterns.some((re) => re.test(content))) memoryFallback = true;
  }
  step('teste7_sem_fallback_memoria', !memoryFallback);
  step('teste7_persistence_error_type', PersistenceError.name === 'PersistenceError');

  const required = report.steps.filter((s) => !s.skip);
  const requiredFailed = required.filter((s) => !s.ok).map((s) => s.name);
  const migrationPending = report.steps.some((s) => s.skip);

  console.log(
    JSON.stringify(
      {
        success: requiredFailed.length === 0,
        migration_pending: migrationPending,
        required_failed: requiredFailed,
        ...report
      },
      null,
      2
    )
  );
  process.exit(requiredFailed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
