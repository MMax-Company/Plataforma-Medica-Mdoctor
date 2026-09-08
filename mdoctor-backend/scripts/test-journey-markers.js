// Testa isoladamente (sem rede/banco, mesmo padrão de stub de require.cache):
//   1) o marcador próprio da pesquisa pós-entrega continua idempotente e não
//      altera o status do atendimento;
//   2) computeTempos usa os eventos clínicos corretos: "Vamos começar" para
//      Triagem e envio da receita/opção 3 para encerrar a Jornada Completa.
const assert = require('assert');
const path = require('path');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const results = {};

async function testRecordJourneyCompletedAt() {
  const base = path.join(__dirname, '..', 'src', 'services', 'post-delivery-survey.service.js');
  const resolveFrom = (p) => path.join(path.dirname(base), p);

  let atendimentos = [
    { id: 'at-1', status: 'delivered', medico_id: 'doc-1', motivo_decisao: 'ok', dados_clinicos: { jornada: { primeiro_oi_em: '2026-07-01T10:00:00.000Z' } } }
  ];
  const sentMessages = [];
  const sessions = {};
  const outcomes = [];
  const updateCalls = [];

  stub(resolveFrom('../delivery/delivery.service'), {
    isDryRunMode: () => false,
    resolveWhatsAppProvider: () => 'meta',
    sendWhatsAppText: async ({ to, text, idempotencyKey }) => {
      sentMessages.push({ to, text, idempotencyKey });
      return { providerMessageId: `wamid-${sentMessages.length}` };
    }
  });
  stub(resolveFrom('../store/patient-outcomes.store'), {
    createPendingOutcome: async ({ attendanceId, patientId, surveyVersion }) => {
      const row = { id: 'outcome-1', attendance_id: attendanceId, patient_id: patientId || null, survey_version: surveyVersion, final_question_access_alternative: null, final_question_avoided_interruption: null, final_question_use_again: null };
      outcomes.push(row);
      return row;
    },
    getOutcomeByAttendance: async (attendanceId, surveyVersion) => outcomes.find((o) => o.attendance_id === attendanceId && o.survey_version === surveyVersion) || null,
    getOutcomeById: async (id) => outcomes.find((o) => o.id === id) || null,
    updateOutcomeFields: async () => null
  });
  stub(resolveFrom('../store/whatsapp-sessions.store'), {
    normalizePhone: (v) => String(v || '').replace(/\D/g, ''),
    getActiveSurveySession: () => null,
    getSessionByPhone: async (phone) => sessions[phone] || null,
    upsertSessionMetadata: async ({ phone, metadataPatch }) => {
      sessions[phone] = { phone, metadata: { ...(sessions[phone]?.metadata || {}), ...metadataPatch } };
    },
    clearSurveySession: async () => {},
    clearTypebotSession: async () => {}
  });
  stub(resolveFrom('../store/audit.store'), { createAuditLog: async () => {} });
  stub(resolveFrom('../store/atendimentos.store'), {
    getAtendimento: async (id) => atendimentos.find((a) => a.id === id) || null,
    updateAtendimentoStatus: async (id, status, meta = {}) => {
      updateCalls.push({ id, status, meta });
      const idx = atendimentos.findIndex((a) => a.id === id);
      if (idx === -1) return null;
      atendimentos[idx] = { ...atendimentos[idx], status, dados_clinicos: meta.dados_clinicos !== undefined ? meta.dados_clinicos : atendimentos[idx].dados_clinicos };
      return atendimentos[idx];
    }
  });

  delete require.cache[require.resolve(base)];
  process.env.POST_DELIVERY_SURVEY_ENABLED = 'true';
  const survey = require(base);

  const before = Date.now();
  const trigger = await survey.triggerPostDeliverySurvey({ attendanceId: 'at-1', patientId: 'pac-1', phone: '5511988880001' });
  assert.equal(trigger.triggered, true);

  const updated = atendimentos.find((a) => a.id === 'at-1');
  assert(updated.dados_clinicos.jornada.pos_entrega_enviada_em, 'pos_entrega_enviada_em foi gravado');
  const writtenAt = new Date(updated.dados_clinicos.jornada.pos_entrega_enviada_em).getTime();
  assert(writtenAt >= before && writtenAt <= Date.now(), 'timestamp gravado é do momento do envio');
  assert.equal(updated.dados_clinicos.jornada.primeiro_oi_em, '2026-07-01T10:00:00.000Z', 'primeiro_oi_em pré-existente é preservado, não sobrescrito');
  assert.equal(updated.status, 'delivered', 'status do atendimento não é alterado por este marcador');
  assert.equal(updateCalls[0].meta.medicoId, 'doc-1', 'medico_id é preservado (não zerado)');
  results.recordJourneyCompletedAtGravaSemAlterarStatus = 'ok';

  // Idempotência: trigger de novo (mesmo attendanceId) não deve gravar de novo
  // (guarda de "existing" já impede reentrada antes de chegar no marcador).
  const callsBefore = updateCalls.length;
  const trigger2 = await survey.triggerPostDeliverySurvey({ attendanceId: 'at-1', patientId: 'pac-1', phone: '5511988880001' });
  assert.equal(trigger2.skipped, true);
  assert.equal(updateCalls.length, callsBefore, 'segundo disparo não grava o marcador de novo');
  results.idempotenciaNaoRegravaMarcador = 'ok';

  return 'ok';
}

async function testComputeTemposComJornada() {
  const base = path.join(__dirname, '..', 'src', 'routes', 'admin.routes.js');
  const resolveFrom = (p) => path.join(path.dirname(base), p);

  stub(resolveFrom('../store/atendimentos.store'), {
    STATUS: {
      DELIVERED: 'delivered',
      REJECTED: 'rejected',
      APPROVED: 'approved',
      EM_ATENDIMENTO: 'em_atendimento'
    },
    listAtendimentos: async () => [],
    getAtendimento: async () => null,
    updateAtendimentoStatus: async () => null,
    listRecentDecisoesLog: async () => [],
    listDecisoesLog: async (atendimentoId) => {
      if (atendimentoId !== 'at-jornada-1') return [];
      return [
        { atendimento_id: 'at-jornada-1', status_novo: 'em_atendimento', criado_em: '2026-07-01T10:20:00.000Z' },
        { atendimento_id: 'at-jornada-1', status_novo: 'approved', criado_em: '2026-07-01T10:20:22.000Z' }
      ];
    },
    listStatusHistory: async (atendimentoId) => {
      if (atendimentoId !== 'at-jornada-1') return [];
      // Inclui linha 'delivered' repetida de propósito — computeTempos deve
      // usar a PRIMEIRA ocorrência (10:35:00), não a segunda (10:41:00).
      return [
        { status_novo: 'awaiting_prescription_upload', criado_em: '2026-07-01T10:12:00.000Z' },
        { status_novo: 'waiting', criado_em: '2026-07-01T10:15:00.000Z' },
        { status_novo: 'em_atendimento', criado_em: '2026-07-01T10:20:00.000Z' },
        { status_novo: 'approved', criado_em: '2026-07-01T10:20:22.000Z' },
        { status_novo: 'receita_em_edicao', criado_em: '2026-07-01T10:21:00.000Z' },
        { status_novo: 'receita_emitida', criado_em: '2026-07-01T10:24:00.000Z' },
        { status_novo: 'ready', criado_em: '2026-07-01T10:24:10.000Z' },
        { status_novo: 'delivered', criado_em: '2026-07-01T10:35:00.000Z' },
        { status_novo: 'delivered', criado_em: '2026-07-01T10:41:00.000Z' }
      ];
    },
    statusInGroup: (status, group) => group === 'queue' && status === 'waiting'
  });
  stub(resolveFrom('../constants/whatsapp-queue'), {
    QUEUE_TYPE_MEDICAL_SUPPORT: 'medical_support',
    isSupportQueue: () => false
  });

  delete require.cache[require.resolve(base)];
  const admin = require(base);

  const atendimentos = [
    {
      id: 'at-jornada-1',
      status: 'delivered',
      criado_em: '2026-07-01T10:15:00.000Z',
      dados_clinicos: {
        jornada: {
          primeiro_oi_em: '2026-07-01T10:00:00.000Z',
          triagem_iniciada_em: '2026-07-01T10:02:00.000Z',
          pos_entrega_enviada_em: '2026-07-01T10:40:00.000Z'
        },
        stripe_paid_at: '2026-07-01T10:13:00.000Z',
        clinical_audit: { approvedAt: '2026-07-01T10:25:00.000Z' },
        entrega_receita: { sent_at: '2026-07-01T10:35:00.000Z' }
      }
    },
    {
      // Atendimento concluído SEM marcadores de jornada (criado antes desta
      // implementação, ou fora do fluxo WhatsApp) — não deve virar "0 min"
      // fabricado, apenas fica fora da amostra de triagem/jornada_completa.
      id: 'at-sem-jornada',
      status: 'delivered',
      criado_em: '2026-07-01T09:00:00.000Z',
      dados_clinicos: {
        clinical_audit: { approvedAt: '2026-07-01T09:10:00.000Z' },
        entrega_receita: { sent_at: '2026-07-01T09:15:00.000Z' }
      }
    }
  ];

  const tempos = await admin.computeTempos(atendimentos);

  // Triagem clínica: clique "Vamos começar" 10:02 -> criado_em 10:15 = 13 min.
  assert.equal(tempos.triagem, '13 min');
  // Avaliação real: clique "Atender" 10:20 -> decisão 10:20:22; não arredonda para zero.
  assert.equal(tempos.avaliacao, '< 1 min');
  // Jornada completa: primeiro Oi 10:00 -> envio da receita/opção 3 às 10:35 = 35 min.
  assert.equal(tempos.jornada_completa, '35 min');
  assert.equal(tempos.amostra_por_indicador.triagem, 1, 'só o atendimento com marcador entra na amostra');
  assert.equal(tempos.amostra_por_indicador.jornada_completa, 1);
  assert.equal(tempos.amostra, 1, 'amostra do cabeçalho só conta jornada completa + receita entregue');
  results.computeTemposLeJornadaCorretamente = 'ok';

  // Etapas reconstruídas de appointment_status_history (+ stripe_paid_at).
  assert.equal(tempos.pagamento_fila, '2 min', 'stripe_paid_at 10:13 -> waiting 10:15');
  assert.equal(tempos.envio_receita_anterior, '3 min', 'awaiting_prescription_upload 10:12 -> waiting 10:15');
  assert.equal(tempos.geracao_receita, '3 min', 'receita_em_edicao 10:21 -> receita_emitida 10:24');
  assert.equal(tempos.receita_pronta_entrega, '11 min', 'ready 10:24:10 -> PRIMEIRO delivered 10:35 (ignora o 10:41 repetido)');
  assert.equal(tempos.amostra_por_indicador.pagamento_fila, 1);
  assert.equal(tempos.amostra_por_indicador.envio_receita_anterior, 1);
  assert.equal(tempos.amostra_por_indicador.geracao_receita, 1);
  assert.equal(tempos.amostra_por_indicador.receita_pronta_entrega, 1);
  results.computeTemposEtapasStatusHistory = 'ok';

  assert.equal(admin.isAdministrativePending({ status: 'awaiting_prescription_upload', dados_clinicos: {} }), true);
  assert.equal(admin.isAdministrativePending({ status: 'waiting', pagamento_status: 'PENDENTE', dados_clinicos: {} }), true);
  assert.equal(admin.isAdministrativePending({ status: 'waiting', pagamento_status: 'CONFIRMADO', dados_clinicos: {} }), false);
  assert.equal(
    admin.isAdministrativePending({
      status: 'delivered',
      pagamento_status: 'CONFIRMADO',
      dados_clinicos: { observacoes_admin: [{ resolvido: false }] }
    }),
    true
  );
  results.pendenciasAdministrativas = 'ok';

  return 'ok';
}

// Guard anti-contaminação: whatsapp_sessions é uma linha persistente por
// telefone; um marcador "congelado" de jornada anterior não pode entrar num
// atendimento novo (auditoria 07/09/2026 — 0 de 7 históricos tinham vínculo
// confiável exatamente por isso).
function testJourneyMarkerContaminationGuard() {
  const base = path.join(__dirname, '..', 'src', 'services', 'triagem-webhook.service.js');
  const resolveFrom = (p) => path.join(path.dirname(base), p);
  // stubs mínimos só para o require não tentar rede/banco no carregamento
  stub(resolveFrom('../store/whatsapp-sessions.store'), {
    getSessionByPhone: async () => null,
    clearJourneyMarkers: async () => null
  });
  stub(resolveFrom('../store/patients.store'), { findOrCreatePatient: async () => null });
  delete require.cache[require.resolve(base)];
  const { resolveJourneyMarkers } = require(base);

  const nowMs = Date.parse('2026-09-07T12:00:00.000Z');

  // 1) Jornada válida: marcadores minutos antes da criação → copiados.
  const ok = resolveJourneyMarkers(
    { metadata: { journey_started_at: '2026-09-07T11:48:00.000Z', welcome_clicked_at: '2026-09-07T11:50:00.000Z' } },
    nowMs
  );
  assert.equal(ok.primeiro_oi_em, '2026-09-07T11:48:00.000Z');
  assert.equal(ok.triagem_iniciada_em, '2026-09-07T11:50:00.000Z');

  // 2) Marcador congelado de 32 dias antes (caso real nº 1090) → descartado.
  const stale = resolveJourneyMarkers(
    { metadata: { journey_started_at: '2026-07-30T05:47:54.000Z', welcome_clicked_at: '2026-07-30T05:49:36.000Z' } },
    nowMs
  );
  assert.deepEqual(stale, {}, 'marcador antigo demais não contamina o atendimento novo');

  // 3) Marcador no futuro (posterior à criação) → descartado.
  const future = resolveJourneyMarkers(
    { metadata: { journey_started_at: '2026-09-07T12:30:00.000Z' } },
    nowMs
  );
  assert.deepEqual(future, {});

  // 4) Ordem impossível (oi depois do "Vamos começar") → descarta os dois.
  const inverted = resolveJourneyMarkers(
    { metadata: { journey_started_at: '2026-09-07T11:55:00.000Z', welcome_clicked_at: '2026-09-07T11:50:00.000Z' } },
    nowMs
  );
  assert.deepEqual(inverted, {});

  // 5) Sessão inexistente → sem campo, sem erro.
  assert.deepEqual(resolveJourneyMarkers(null, nowMs), {});

  results.journeyMarkerContaminationGuard = 'ok';
  return 'ok';
}

async function main() {
  results.recordJourneyCompletedAt = await testRecordJourneyCompletedAt();
  results.computeTemposComJornada = await testComputeTemposComJornada();
  results.journeyMarkerGuard = testJourneyMarkerContaminationGuard();
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
