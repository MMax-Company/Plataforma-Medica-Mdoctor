// Fase 3 pedido 1 — testes isolados (sem rede/banco) da decisão médica:
// aprovação e reprovação idempotentes, reprovação sem estorno automático
// (apenas pendência administrativa registrada) e mensagens WhatsApp únicas.
// Usa o mesmo padrão de stub de require.cache já usado em
// test-prescription-upload-ambiguity-unit.js para exercitar as funções REAIS
// de produção sem tocar Supabase/Meta/Stripe.
const assert = require('assert');
const path = require('path');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const base = path.join(__dirname, '..', 'src', 'services', 'clinical-decision.service.js');
const resolveFrom = (p) => path.join(path.dirname(base), p);

const STATUS = {
  WAITING: 'waiting',
  APPROVED: 'approved',
  RECEITA_EM_EDICAO: 'receita_em_edicao',
  RECEITA_EMITIDA: 'receita_emitida',
  MEMED_PROCESSING: 'memed_processing',
  AWAITING_VALIDATION: 'awaiting_validation',
  READY: 'ready',
  VALIDATED: 'validated',
  APROVADO: 'aprovado',
  DELIVERED: 'delivered',
  FINISHED: 'finished',
  REJECTED: 'rejected'
};

let atendimentoFixture = null;
let decisaoLogs = [];
let auditLogs = [];
let outboxRows = [];
let sentTexts = [];
let rowSeq = 0;

function findPendingByKind(atendimentoId, kind) {
  return (
    outboxRows.find(
      (r) => r.appointment_id === atendimentoId && r.direction === 'outbound' && r.metadata.message_kind === kind
    ) || null
  );
}

function enqueueGeneric({ atendimentoId, phone, message, doctorId, correlationId, kind }) {
  const existing = findPendingByKind(atendimentoId, kind);
  if (existing) return { message: existing, duplicate: true };
  rowSeq += 1;
  const row = {
    id: `msg-${rowSeq}`,
    appointment_id: atendimentoId,
    direction: 'outbound',
    phone,
    body: message,
    status: 'pending',
    provider_message_id: null,
    metadata: {
      message_kind: kind,
      idempotency_key: `${kind}:${atendimentoId}`,
      doctor_id: doctorId || null,
      correlation_id: correlationId || null
    },
    created_at: new Date().toISOString()
  };
  outboxRows.push(row);
  return { message: row, duplicate: false };
}

stub(resolveFrom('./clinical-intelligence.service'), { PROTOCOL_VERSION: 'test-v1' });
stub(resolveFrom('./clinical-payload-normalizer.service'), { isVisibleInMedicalPanel: () => true });
stub(resolveFrom('../constants/clinical-reject-reasons'), {
  validateRejectPayload: (body = {}) => ({
    ok: true,
    reasonCode: body.reason_code || 'OUTROS',
    detail: body.observacao_medica || body.motivo || null,
    meta: { label: 'Outros' }
  }),
  buildRejectMotivoText: ({ reasonCode, detail }) => `${reasonCode}: ${detail || ''}`.trim()
});
stub(resolveFrom('../store/audit.store'), {
  createAuditLog: async (entry) => {
    auditLogs.push(entry);
    return entry;
  }
});
stub(resolveFrom('../store/atendimentos.store'), {
  STATUS,
  getAtendimento: async (id) => (atendimentoFixture && atendimentoFixture.id === id ? atendimentoFixture : null),
  updateAtendimentoStatus: async (id, status, meta = {}) => {
    atendimentoFixture = {
      ...atendimentoFixture,
      status,
      motivo_decisao: meta.motivo,
      dados_clinicos: meta.dados_clinicos !== undefined ? meta.dados_clinicos : atendimentoFixture.dados_clinicos
    };
    return atendimentoFixture;
  },
  createDecisaoLog: async (payload) => {
    const row = { id: `decisao-${decisaoLogs.length + 1}`, ...payload };
    decisaoLogs.push(row);
    return row;
  }
});
stub(resolveFrom('../store/whatsapp-outbox.store'), {
  REJECTION_MESSAGE_KIND: 'clinical_rejection',
  APPROVAL_MESSAGE_KIND: 'clinical_approval',
  enqueueClinicalRejection: async ({ atendimentoId, phone, message, doctorId, correlationId }) =>
    enqueueGeneric({ atendimentoId, phone, message, doctorId, correlationId, kind: 'clinical_rejection' }),
  enqueueClinicalApproval: async ({ atendimentoId, phone, message, doctorId, correlationId }) =>
    enqueueGeneric({ atendimentoId, phone, message, doctorId, correlationId, kind: 'clinical_approval' }),
  findPendingRejectionMessage: async (atendimentoId) => findPendingByKind(atendimentoId, 'clinical_rejection'),
  findPendingApprovalMessage: async (atendimentoId) => findPendingByKind(atendimentoId, 'clinical_approval'),
  claimRejectionMessageForSend: async (messageId) => {
    const row = outboxRows.find((r) => r.id === messageId);
    if (!row || !['pending', 'failed'].includes(row.status)) return null;
    row.status = 'sending';
    return { ...row };
  },
  finishRejectionMessage: async ({ messageId, status, providerMessageId = null, metadata = {} }) => {
    const row = outboxRows.find((r) => r.id === messageId);
    if (!row) return;
    row.status = status;
    row.provider_message_id = providerMessageId;
    row.metadata = { ...(metadata || row.metadata) };
  }
});
stub(resolveFrom('../delivery/delivery.service'), {
  sendWhatsAppText: async (payload) => {
    sentTexts.push(payload);
    return { providerMessageId: `wamid-${sentTexts.length}` };
  }
});

delete require.cache[require.resolve(base)];
const clinicalDecision = require(base);

function freshApprovableAtendimento(id) {
  return {
    id,
    status: STATUS.WAITING,
    paciente_nome: 'Paciente Teste',
    paciente_telefone: '5511999990000',
    pagamento_status: 'CONFIRMADO',
    dados_clinicos: {
      previous_prescription: true,
      foto_receita_url: 'https://example.com/foto-receita.jpg'
    }
  };
}

function resetState(fixture) {
  atendimentoFixture = fixture;
  decisaoLogs = [];
  auditLogs = [];
  outboxRows = [];
  sentTexts = [];
}

async function main() {
  const results = {};

  // 1) Aprovação repetida não duplica decisão nem mensagem; clique repetido
  //    devolve a decisão existente (duplicate:true) em vez de erro.
  {
    resetState(freshApprovableAtendimento('at-approve-1'));
    const r1 = await clinicalDecision.approveAtendimento('at-approve-1', {}, { doctorId: 'doc-1', correlationId: 'c-1' });
    assert.equal(r1.ok, true);
    assert.equal(r1.duplicate, false);
    assert.equal(r1.atendimento.status, STATUS.APPROVED);
    assert.equal(decisaoLogs.length, 1);
    assert.equal(sentTexts.length, 1, 'envia a confirmação de aprovação uma única vez');
    assert(sentTexts[0].text.includes('Sua solicitação foi aprovada pelo médico'));
    assert(sentTexts[0].text.includes('A receita está sendo preparada para envio'));

    const r2 = await clinicalDecision.approveAtendimento('at-approve-1', {}, { doctorId: 'doc-1', correlationId: 'c-2' });
    assert.equal(r2.ok, true);
    assert.equal(r2.duplicate, true);
    assert.equal(r2.decisao, null);
    assert.equal(decisaoLogs.length, 1, 'clique repetido não cria segunda decisão');
    assert.equal(sentTexts.length, 1, 'clique repetido não repete a mensagem de aprovação');
    results.aprovacaoRepetidaNaoDuplicaDecisao = 'ok';
  }

  // 2) Receita já emitida/em edição: aprovação bloqueada, nenhuma nova
  //    decisão é criada (receita existente não é recriada).
  {
    const fixture = freshApprovableAtendimento('at-approve-2');
    fixture.status = STATUS.RECEITA_EMITIDA;
    fixture.dados_clinicos.memed_receita = { receitaId: 'rec-123' };
    resetState(fixture);
    const r = await clinicalDecision.approveAtendimento('at-approve-2', {}, { doctorId: 'doc-1', correlationId: 'c-1' });
    assert.equal(r.ok, false);
    assert.equal(decisaoLogs.length, 0, 'nenhuma decisão nova é registrada');
    assert.equal(sentTexts.length, 0, 'nenhuma mensagem é enviada quando a aprovação é bloqueada');
    results.receitaExistenteNaoRecriada = 'ok';
  }

  // 3) APROVAR não executa reprovação: status final é approved, não rejected,
  //    e memed_bloqueado permanece ausente/false.
  {
    resetState(freshApprovableAtendimento('at-approve-3'));
    const r = await clinicalDecision.approveAtendimento('at-approve-3', {}, { doctorId: 'doc-1', correlationId: 'c-1' });
    assert.equal(r.atendimento.status, STATUS.APPROVED);
    assert.notEqual(r.atendimento.status, STATUS.REJECTED);
    assert.notEqual(r.atendimento.dados_clinicos?.memed_bloqueado, true);
    results.aprovarNaoExecutaReprovacao = 'ok';
  }

  // 4) Reprovação repetida não duplica decisão nem mensagem; clique repetido
  //    devolve a decisão existente (duplicate:true).
  {
    resetState(freshApprovableAtendimento('at-reject-1'));
    const rej1 = await clinicalDecision.rejectAtendimento(
      'at-reject-1',
      { reason_code: 'FORA_DO_PROTOCOLO', observacao_medica: 'fora do protocolo clinico' },
      { doctorId: 'doc-1', correlationId: 'c-1' }
    );
    assert.equal(rej1.ok, true);
    assert.equal(rej1.duplicate, false);
    assert.equal(rej1.atendimento.status, STATUS.REJECTED);
    assert.equal(decisaoLogs.length, 1);
    assert.equal(sentTexts.length, 1, 'envia a mensagem de reprovação uma única vez');
    assert(sentTexts[0].text.includes('não foi possível emitir a receita solicitada'));
    assert(sentTexts[0].text.includes('providências administrativas referentes ao pagamento'));
    assert(sentTexts[0].text.includes('digite 2 para falar com o suporte'));

    const rej2 = await clinicalDecision.rejectAtendimento('at-reject-1', {}, { doctorId: 'doc-1', correlationId: 'c-2' });
    assert.equal(rej2.ok, true);
    assert.equal(rej2.duplicate, true);
    assert.equal(decisaoLogs.length, 1, 'clique repetido não cria segunda decisão');
    assert.equal(sentTexts.length, 1, 'clique repetido não repete a mensagem de reprovação');
    results.reprovacaoRepetidaNaoDuplicaDecisaoOuMensagem = 'ok';
  }

  // 5) REPROVAR não inicia Memed: memed_bloqueado fica true no atendimento
  //    reprovado.
  {
    resetState(freshApprovableAtendimento('at-reject-2'));
    const rej = await clinicalDecision.rejectAtendimento(
      'at-reject-2',
      { reason_code: 'FORA_DO_PROTOCOLO', observacao_medica: 'fora do protocolo clinico' },
      { doctorId: 'doc-1', correlationId: 'c-1' }
    );
    assert.equal(rej.atendimento.dados_clinicos.memed_bloqueado, true);
    results.reprovarNaoIniciaMemed = 'ok';
  }

  // 6) Reprovação não realiza estorno: nenhum campo de estorno/refund é
  //    criado; em vez disso fica registrada a pendência administrativa.
  {
    resetState(freshApprovableAtendimento('at-reject-3'));
    const rej = await clinicalDecision.rejectAtendimento(
      'at-reject-3',
      { reason_code: 'FORA_DO_PROTOCOLO', observacao_medica: 'fora do protocolo clinico' },
      { doctorId: 'doc-1', correlationId: 'c-1' }
    );
    assert.equal(rej.atendimento.dados_clinicos.estorno, undefined, 'nenhum campo de estorno é criado');
    assert.equal(rej.pendencia_pagamento.status, 'pendente_analise_administrativa');
    assert.equal(rej.pendencia_pagamento.refund_id, undefined);
    assert.equal(rej.atendimento.dados_clinicos.pendencia_pagamento.status, 'pendente_analise_administrativa');
    results.reprovacaoNaoRealizaEstorno = 'ok';
  }

  // 6b) Sem pagamento confirmado, a pendência reflete isso e ainda assim não
  //     chama nenhum código de estorno.
  {
    const fixture = freshApprovableAtendimento('at-reject-4');
    fixture.pagamento_status = 'PENDENTE';
    resetState(fixture);
    const rej = await clinicalDecision.rejectAtendimento(
      'at-reject-4',
      { reason_code: 'FORA_DO_PROTOCOLO', observacao_medica: 'fora do protocolo clinico' },
      { doctorId: 'doc-1', correlationId: 'c-1' }
    );
    assert.equal(rej.pendencia_pagamento.status, 'sem_pagamento_confirmado');
    results.semPagamentoConfirmadoNaoRegistraPendenciaDeEstorno = 'ok';
  }

  // 7) Atendimento fica no estado correto em cada fluxo.
  {
    resetState(freshApprovableAtendimento('at-status-1'));
    const approved = await clinicalDecision.approveAtendimento('at-status-1', {}, { doctorId: 'doc-1', correlationId: 'c-1' });
    assert.equal(approved.atendimento.status, STATUS.APPROVED);

    resetState(freshApprovableAtendimento('at-status-2'));
    const rejected = await clinicalDecision.rejectAtendimento(
      'at-status-2',
      { reason_code: 'FORA_DO_PROTOCOLO', observacao_medica: 'fora do protocolo clinico' },
      { doctorId: 'doc-1', correlationId: 'c-1' }
    );
    assert.equal(rejected.atendimento.status, STATUS.REJECTED);
    results.atendimentoFicaNoEstadoCorreto = 'ok';
  }

  // 8) REPROVAR não inicia Memed nem emite receita mesmo com nova tentativa
  //    de aprovação sobre o mesmo atendimento já reprovado.
  {
    resetState(freshApprovableAtendimento('at-reject-5'));
    await clinicalDecision.rejectAtendimento(
      'at-reject-5',
      { reason_code: 'FORA_DO_PROTOCOLO', observacao_medica: 'fora do protocolo clinico' },
      { doctorId: 'doc-1', correlationId: 'c-1' }
    );
    const approveAttempt = await clinicalDecision.approveAtendimento('at-reject-5', {}, { doctorId: 'doc-1', correlationId: 'c-2' });
    assert.equal(approveAttempt.ok, false);
    results.reprovadoNaoPodeSerAprovado = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
