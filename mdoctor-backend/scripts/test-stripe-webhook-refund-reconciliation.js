// Pedido 02/08/2026 (itens 2 e 3 dos testes offline): reconciliação dos
// eventos refund.created/refund.updated/refund.failed via
// applyStripeRefundReconciliation (stripe-webhook.service.js), e garantia de
// que SOMENTE estornos criados pelo próprio backend (refund_id já registrado
// em dados_clinicos.estorno) são reconciliados — um refund.id externo, ou a
// ausência de qualquer estorno registrado, nunca cria estado novo.
//
// Usa o mesmo padrão de stub de require.cache dos demais testes desta pasta:
// dubla todas as dependências do módulo (mesmo as não usadas por esta função
// específica, para manter o require 100% offline) e exercita a função REAL.
const assert = require('assert');
const path = require('path');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const base = path.join(__dirname, '..', 'src', 'services', 'stripe-webhook.service.js');
const resolveFrom = (p) => path.join(path.dirname(base), p);

const STATUS = { WAITING: 'waiting', REJECTED: 'rejected' };

let atendimentoFixture = null;
let auditLogs = [];
let updateCalls = [];
let findPaymentByAppointmentCalls = [];
let markPaymentRefundedCalls = [];
let paymentRowToReturn = null;

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
    updateCalls.push({ id, status, meta });
    // Replica o comportamento real do store (atendimentos.store.js): meta.motivo
    // e meta.medicoId ausentes gravam motivo_decisao/medico_id como null — não
    // preservam o valor anterior. Sem essa dublagem fiel, este teste não teria
    // pegado o achado 02/08/2026 (applyStripeRefundReconciliation zerava o
    // motivo da reprovação e o médico responsável a cada reconciliação de
    // estorno, por não repassar motivo/medicoId ao chamar updateAtendimentoStatus).
    atendimentoFixture = {
      ...atendimentoFixture,
      status,
      motivo_decisao: meta.motivo || null,
      medico_id: meta.medicoId || null,
      dados_clinicos: meta.dados_clinicos !== undefined ? meta.dados_clinicos : atendimentoFixture.dados_clinicos
    };
    return atendimentoFixture;
  }
});
stub(resolveFrom('../store/payments.store'), {
  findPaymentByAppointment: async (appointmentId) => {
    findPaymentByAppointmentCalls.push(appointmentId);
    return paymentRowToReturn;
  },
  findPaymentEventByProviderId: async () => null,
  markPaymentRefunded: async (paymentId) => {
    markPaymentRefundedCalls.push(paymentId);
  },
  recordStripePaymentEvent: async () => {}
});
stub(resolveFrom('./clinical-persistence.service'), { recordIntegrationLog: async () => {} });
stub(resolveFrom('./prescription-upload-token.service'), {
  isExternalUploadEnabled: () => false,
  ensurePrescriptionUploadSession: async () => {}
});
stub(resolveFrom('./typebot-payment-link.service'), {
  applyCheckoutWebhook: async () => ({ ok: false, code: 'SESSION_NOT_FOUND' }),
  completePaymentByToken: async () => ({ ok: false }),
  findSessionByPaymentIntentId: async () => null
});

delete require.cache[require.resolve(base)];
const {
  applyStripeRefundReconciliation,
  isRefundStripeEvent,
  handleStripeWebhookEvent
} = require(base);

function resetState(fixture, { paymentRow = null } = {}) {
  atendimentoFixture = fixture;
  auditLogs = [];
  updateCalls = [];
  findPaymentByAppointmentCalls = [];
  markPaymentRefundedCalls = [];
  paymentRowToReturn = paymentRow;
}

function atendimentoComEstorno(id, estornoOverrides = {}) {
  return {
    id,
    status: STATUS.REJECTED,
    motivo_decisao: 'fora do protocolo clinico',
    medico_id: 42,
    dados_clinicos: {
      estorno: {
        status: 'pending',
        refund_id: 'ref_backend_123',
        payment_intent: 'pi_abc',
        attempt: 1,
        ...estornoOverrides
      },
      pendencia_pagamento: { status: 'estorno_iniciado' }
    }
  };
}

function refundEvent({ id = 'evt_1', type, refundId, status, atendimentoId, paymentIntent = 'pi_abc' }) {
  return {
    id,
    type,
    data: {
      object: {
        id: refundId,
        status,
        payment_intent: paymentIntent,
        metadata: { atendimento_id: atendimentoId }
      }
    }
  };
}

async function main() {
  const results = {};

  // 1) isRefundStripeEvent identifica corretamente os 3 tipos de evento e
  //    rejeita um tipo não relacionado a estorno.
  {
    assert.equal(isRefundStripeEvent('refund.created'), true);
    assert.equal(isRefundStripeEvent('refund.updated'), true);
    assert.equal(isRefundStripeEvent('refund.failed'), true);
    assert.equal(isRefundStripeEvent('checkout.session.completed'), false);
    results.isRefundStripeEventClassificaCorretamente = 'ok';
  }

  // 2) refund.updated -> succeeded: estorno concluído, pendência atualizada,
  //    payments.status marcado como reembolsado, auditoria registrada.
  {
    resetState(atendimentoComEstorno('at-1'), { paymentRow: { id: 'pay-1' } });
    const event = refundEvent({ id: 'evt_succeeded', type: 'refund.updated', refundId: 'ref_backend_123', status: 'succeeded', atendimentoId: 'at-1' });
    const res = await applyStripeRefundReconciliation(event);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.refund_status, 'succeeded');
    assert.equal(atendimentoFixture.dados_clinicos.estorno.status, 'succeeded');
    assert.equal(atendimentoFixture.dados_clinicos.pendencia_pagamento.status, 'estorno_concluido');
    assert.equal(markPaymentRefundedCalls.length, 1, 'markPaymentRefunded é chamado quando o refund assíncrono conclui');
    assert.equal(markPaymentRefundedCalls[0], 'pay-1');
    assert.equal(auditLogs.length, 1);
    assert.equal(auditLogs[0].action, 'refund_status_synced');
    results.refundUpdatedParaSucceededConcluiEstorno = 'ok';
  }

  // 2b) GARANTIA (achado 02/08/2026): reconciliar um estorno via webhook NÃO
  //     pode apagar o motivo da reprovação médica nem o médico responsável —
  //     updateAtendimentoStatus zera esses campos quando motivo/medicoId não
  //     são passados explicitamente (comportamento real do store).
  {
    resetState(atendimentoComEstorno('at-1b'), { paymentRow: { id: 'pay-1b' } });
    const event = refundEvent({ id: 'evt_succeeded_2b', type: 'refund.updated', refundId: 'ref_backend_123', status: 'succeeded', atendimentoId: 'at-1b' });
    await applyStripeRefundReconciliation(event);
    assert.equal(updateCalls[0].meta.motivo, 'fora do protocolo clinico', 'motivo_decisao original é preservado na reconciliação de estorno');
    assert.equal(updateCalls[0].meta.medicoId, 42, 'medico_id original é preservado na reconciliação de estorno');
    assert.equal(atendimentoFixture.motivo_decisao, 'fora do protocolo clinico');
    assert.equal(atendimentoFixture.medico_id, 42);
    results.reconciliacaoDeEstornoPreservaMotivoEMedicoResponsavel = 'ok';
  }

  // 3) refund.failed: pendência cai para análise administrativa, sem marcar
  //    pagamento como reembolsado.
  {
    resetState(atendimentoComEstorno('at-2'), { paymentRow: { id: 'pay-2' } });
    const event = refundEvent({ id: 'evt_failed', type: 'refund.failed', refundId: 'ref_backend_123', status: 'failed', atendimentoId: 'at-2' });
    const res = await applyStripeRefundReconciliation(event);
    assert.equal(res.body.refund_status, 'failed');
    assert.equal(atendimentoFixture.dados_clinicos.estorno.status, 'failed');
    assert.equal(atendimentoFixture.dados_clinicos.pendencia_pagamento.status, 'pendente_analise_administrativa');
    assert.equal(markPaymentRefundedCalls.length, 0, 'refund falho não marca pagamento como reembolsado');
    results.refundFailedCaiParaPendenciaAdministrativa = 'ok';
  }

  // 4) refund.created com o MESMO status já registrado (redelivery) — não
  //    duplica auditoria nem chama updateAtendimentoStatus de novo.
  {
    resetState(atendimentoComEstorno('at-3', { status: 'pending' }));
    const event = refundEvent({ id: 'evt_dup', type: 'refund.created', refundId: 'ref_backend_123', status: 'pending', atendimentoId: 'at-3' });
    const res = await applyStripeRefundReconciliation(event);
    assert.equal(res.body.duplicate, true);
    assert.equal(updateCalls.length, 0, 'redelivery do mesmo status não grava de novo');
    assert.equal(auditLogs.length, 0, 'redelivery do mesmo status não duplica auditoria');
    results.redeliveryDoMesmoStatusEIgnorada = 'ok';
  }

  // 5) GARANTIA CENTRAL (item 3 do pedido): refund_id do evento é DIFERENTE
  //    do refund_id que o backend registrou — evento é ignorado, nenhum
  //    estado é criado ou alterado, mesmo com atendimento_id válido.
  {
    resetState(atendimentoComEstorno('at-4', { refund_id: 'ref_backend_123' }));
    const event = refundEvent({ id: 'evt_estranho', type: 'refund.updated', refundId: 'ref_NAO_CRIADO_PELO_BACKEND', status: 'succeeded', atendimentoId: 'at-4' });
    const res = await applyStripeRefundReconciliation(event);
    assert.equal(res.body.ignored, true);
    assert.equal(res.body.reason, 'refund_not_linked');
    assert.equal(updateCalls.length, 0, 'refund não vinculado nunca grava estado');
    assert.equal(auditLogs.length, 0);
    assert.equal(atendimentoFixture.dados_clinicos.estorno.status, 'pending', 'estorno original permanece intocado');
    results.refundIdDiferenteDoBackendEIgnorado = 'ok';
  }

  // 6) GARANTIA CENTRAL (item 3): atendimento sem NENHUM estorno registrado
  //    (dados_clinicos.estorno ausente) — mesmo evento de refund "legítimo"
  //    da Stripe para essa metadata é ignorado, nunca cria um estorno do
  //    zero a partir do webhook.
  {
    resetState({ id: 'at-5', status: STATUS.WAITING, dados_clinicos: {} });
    const event = refundEvent({ id: 'evt_sem_estorno_previo', type: 'refund.created', refundId: 'ref_qualquer', status: 'pending', atendimentoId: 'at-5' });
    const res = await applyStripeRefundReconciliation(event);
    assert.equal(res.body.ignored, true);
    assert.equal(res.body.reason, 'refund_not_linked');
    assert.equal(updateCalls.length, 0);
    assert.equal(atendimentoFixture.dados_clinicos.estorno, undefined, 'nenhum estorno é criado a partir do webhook');
    results.semEstornoPrevioRegistradoNuncaCriaEstadoAPartirDoWebhook = 'ok';
  }

  // 7) atendimento_id ausente no metadata do evento — ignorado sem tentar
  //    buscar atendimento.
  {
    resetState(null);
    const event = { id: 'evt_sem_meta', type: 'refund.created', data: { object: { id: 'ref_x', status: 'pending', metadata: {} } } };
    const res = await applyStripeRefundReconciliation(event);
    assert.equal(res.body.reason, 'missing_atendimento_id');
    results.semAtendimentoIdNoMetadataEIgnorado = 'ok';
  }

  // 8) atendimento_id presente mas atendimento não existe no banco —
  //    ignorado.
  {
    resetState(null);
    const event = refundEvent({ id: 'evt_nao_existe', type: 'refund.created', refundId: 'ref_x', status: 'pending', atendimentoId: 'at-nao-existe' });
    const res = await applyStripeRefundReconciliation(event);
    assert.equal(res.body.reason, 'atendimento_not_found');
    results.atendimentoInexistenteEIgnorado = 'ok';
  }

  // 9) Roteamento: handleStripeWebhookEvent despacha eventos de refund para
  //    applyStripeRefundReconciliation (e não cai no fluxo de pagamento
  //    pago/typebot).
  {
    resetState(atendimentoComEstorno('at-6'), { paymentRow: { id: 'pay-6' } });
    const event = refundEvent({ id: 'evt_roteamento', type: 'refund.updated', refundId: 'ref_backend_123', status: 'succeeded', atendimentoId: 'at-6' });
    const res = await handleStripeWebhookEvent(event);
    assert.equal(res.body.refund_status, 'succeeded');
    assert.equal(res.body.atendimentoId, 'at-6');
    results.handleStripeWebhookEventRoteiaEventosDeRefund = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
