// Testa isoladamente (sem rede/banco, mesmo padrão de stub de require.cache
// dos demais testes da Fase 3) os dois marcadores de jornada novos:
//   1) recordJourneyCompletedAt (post-delivery-survey.service.js) — grava
//      dados_clinicos.jornada.pos_entrega_enviada_em no atendimento no
//      momento em que a mensagem pós-entrega é enviada.
//   2) computeTempos (admin.routes.js) — lê dados_clinicos.jornada.* para
//      calcular Triagem e Jornada Completa.
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
    STATUS: { DELIVERED: 'delivered', REJECTED: 'rejected', EM_ATENDIMENTO: 'em_atendimento' },
    listAtendimentos: async () => [],
    getAtendimento: async () => null,
    updateAtendimentoStatus: async () => null,
    listRecentDecisoesLog: async () => [],
    listDecisoesLog: async (atendimentoId) => {
      if (atendimentoId !== 'at-jornada-1') return [];
      return [
        { atendimento_id: 'at-jornada-1', status_novo: 'em_atendimento', criado_em: '2026-07-01T10:20:00.000Z' }
      ];
    },
    statusInGroup: () => false
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

  // Triagem: 10:02:00 -> 10:15:00 (criado_em) = 13 min
  assert.equal(tempos.triagem, '13 min');
  // Jornada completa: 10:00:00 -> 10:40:00 = 40 min
  assert.equal(tempos.jornada_completa, '40 min');
  assert.equal(tempos.amostra_por_indicador.triagem, 1, 'só o atendimento com marcador entra na amostra');
  assert.equal(tempos.amostra_por_indicador.jornada_completa, 1);
  assert.equal(tempos.amostra, 2, 'amostra geral inclui os dois atendimentos concluídos');
  results.computeTemposLeJornadaCorretamente = 'ok';

  return 'ok';
}

async function main() {
  results.recordJourneyCompletedAt = await testRecordJourneyCompletedAt();
  results.computeTemposComJornada = await testComputeTemposComJornada();
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
