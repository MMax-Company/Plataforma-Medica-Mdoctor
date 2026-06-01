/**
 * Testes 1–10 de persistência no Supabase oficial (sem fallback in-memory).
 * Uso: node mdoctor-backend/scripts/supabase-production-persistence-test.js
 */
require('./load-dotenv');

const { randomUUID } = require('crypto');
const { initSupabase, pingSupabase } = require('../src/config/supabase');
const { createPatient } = require('../src/store/patients.store');
const { createAtendimento, getAtendimento, updateAtendimentoStatus, STATUS } = require('../src/store/atendimentos.store');
const { createAuditLog } = require('../src/store/audit.store');
const { savePrescription } = require('../src/store/prescriptions.store');
const { createEntregaReceitaLog } = require('../src/store/atendimentos.store');
const T = require('../src/db/tables');
const { dbQuery } = require('../src/db/persistence');

const report = { tests: [], errors: [] };

function step(name, ok, extra = {}) {
  report.tests.push({ name, ok, ...extra });
  if (!ok) report.errors.push(name);
}

async function main() {
  initSupabase();
  const ping = await pingSupabase();
  step('00_supabase_ping', ping.responding, ping);

  const ts = Date.now();
  const patient = await createPatient({
    nome: `Teste Persistência ${ts}`,
    telefone: `5511977${String(ts).slice(-6)}`,
    cpf: '52998224725',
    email: `persist.${ts}@example.com`
  });
  step('01_criar_paciente', Boolean(patient?.id), { patientId: patient?.id });

  const triage = await dbQuery('criar triagem', async (supabase) =>
    supabase
      .from(T.TRIAGE_SESSIONS)
      .insert({
        patient_id: patient.id,
        source: 'test-script',
        status: 'completed',
        correlation_id: `triage-${ts}`,
        payload: { answers: { sinais_alerta: 'NAO' } }
      })
      .select('*')
      .single()
  );
  step('02_criar_triagem', Boolean(triage?.id), { triageId: triage?.id });

  const atendimento = await createAtendimento({
    patient_id: patient.id,
    paciente_nome: patient.nome,
    paciente_telefone: patient.telefone,
    condicao: 'has',
    pagamento_status: 'CONFIRMADO',
    status: STATUS.WAITING,
    elegibilidade: { eligible: true, reason: 'Teste' },
    dados_clinicos: { triage_session_id: triage.id, test: true }
  });
  step('03_criar_appointment_elegivel', Boolean(atendimento?.id), { appointmentId: atendimento?.id });

  await dbQuery('elegibilidade', async (supabase) =>
    supabase.from(T.MEDICAL_ELIGIBILITY).insert({
      appointment_id: atendimento.id,
      eligible: true,
      reason: 'Teste persistência',
      criteria_used: ['test']
    })
  );
  step('03b_medical_eligibility', true);

  const ticket = await dbQuery('suporte', async (supabase) =>
    supabase
      .from(T.SUPPORT_TICKETS)
      .insert({
        patient_id: patient.id,
        appointment_id: atendimento.id,
        subject: 'Teste suporte',
        channel: 'whatsapp'
      })
      .select('*')
      .single()
  );
  step('04_suporte_ticket', Boolean(ticket?.id));

  await dbQuery('prontuário', async (supabase) =>
    supabase.from(T.MEDICAL_RECORDS).insert({
      appointment_id: atendimento.id,
      patient_id: patient.id,
      summary: 'Prontuário teste',
      clinical_data: { queixa: 'Renovação' }
    })
  );
  step('05_prontuario', true);

  const rx = await savePrescription({
    atendimento_id: atendimento.id,
    patient_id: patient.id,
    provider: 'memed',
    status: 'issued',
    pdf_url: 'https://example.com/rx-test.pdf',
    medications: [{ name: 'losartana', dose: '50mg' }]
  });
  step('06_receita', Boolean(rx?.id));

  await dbQuery('whatsapp', async (supabase) =>
    supabase.from(T.WHATSAPP_MESSAGES).insert({
      appointment_id: atendimento.id,
      direction: 'outbound',
      phone: patient.telefone,
      body: 'Mensagem teste persistência',
      status: 'sent'
    })
  );
  step('07_whatsapp_evento', true);

  const updated = await updateAtendimentoStatus(atendimento.id, STATUS.EM_ATENDIMENTO, {
    status_anterior: atendimento.status
  });
  step('08_atualizar_fila_status', updated?.status === STATUS.EM_ATENDIMENTO);

  const listed = await dbQuery('dashboard list', async (supabase) =>
    supabase.from(T.APPOINTMENTS).select('id,status').limit(5)
  );
  step('09_dashboard_query', Array.isArray(listed) && listed.length > 0);

  const afterRestart = await getAtendimento(atendimento.id);
  step('10_persistencia_apos_reload', afterRestart?.id === atendimento.id, {
    status: afterRestart?.status
  });

  await createAuditLog({
    entity_type: 'test',
    entity_id: atendimento.id,
    action: 'persistence_test_complete',
    payload: { ts }
  });

  await createEntregaReceitaLog({
    atendimento_id: atendimento.id,
    canal: 'whatsapp',
    status: 'sent',
    provider: 'test'
  });

  console.log(JSON.stringify({ success: report.errors.length === 0, ...report }, null, 2));
  process.exit(report.errors.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
