// Pedido 02/08/2026 (item 1 dos testes offline): garante que
// resolvePaymentIntentId (stripe-refund.service.js) resolve o payment_intent
// a partir de dados_clinicos.stripe_checkout_session_id — candidato
// adicionado para cobrir o fluxo WhatsApp/Typebot, que nunca grava
// dados_clinicos.stripe_payment nem payments.appointment_id (achado
// 02/08/2026, ver comentário no próprio serviço). Sem esse candidato o
// estorno automático de reprovação nunca resolvia o payment_intent desse
// fluxo, nem para cartão nem para Pix.
//
// Exercita a função REAL de produção (require direto, sem stub do próprio
// arquivo) — só dubla ../store/payments.store (findPaymentByAppointment) e
// injeta um cliente Stripe falso como parâmetro (resolvePaymentIntentId
// recebe `stripe` por injeção, não via require, então não precisamos tocar
// require.cache do pacote stripe aqui).
const assert = require('assert');
const path = require('path');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const base = path.join(__dirname, '..', 'src', 'services', 'stripe-refund.service.js');
const resolveFrom = (p) => path.join(path.dirname(base), p);

let auditLogs = [];
let paymentRowToReturn = null;
let findPaymentByAppointmentCalls = [];

stub(resolveFrom('../store/audit.store'), {
  createAuditLog: async (entry) => {
    auditLogs.push(entry);
    return entry;
  }
});
stub(resolveFrom('../store/payments.store'), {
  findPaymentByAppointment: async (appointmentId) => {
    findPaymentByAppointmentCalls.push(appointmentId);
    return paymentRowToReturn;
  },
  markPaymentRefunded: async () => {}
});

delete require.cache[require.resolve(base)];
const { resolvePaymentIntentId } = require(base);

function resetState({ paymentRow = null } = {}) {
  auditLogs = [];
  paymentRowToReturn = paymentRow;
  findPaymentByAppointmentCalls = [];
}

function fakeStripe({ retrieveResult = null, shouldThrow = false } = {}) {
  const calls = [];
  return {
    calls,
    checkout: {
      sessions: {
        retrieve: async (id) => {
          calls.push(id);
          if (shouldThrow) throw new Error('stripe indisponível (simulado)');
          return retrieveResult;
        }
      }
    }
  };
}

async function main() {
  const results = {};

  // 1) Único vínculo disponível é stripe_checkout_session_id (fluxo
  //    WhatsApp/Typebot real, sem stripe_payment nem payments row) —
  //    resolve via stripe.checkout.sessions.retrieve.
  {
    resetState();
    const stripe = fakeStripe({ retrieveResult: { payment_intent: 'pi_resolved_from_checkout_session' } });
    const atendimento = {
      id: 'at-1',
      dados_clinicos: { stripe_checkout_session_id: 'cs_test_whatsapp_flow' }
    };
    const result = await resolvePaymentIntentId({ stripe, atendimento, requestedPaymentIntent: null });
    assert.equal(result.paymentIntentId, 'pi_resolved_from_checkout_session');
    assert.equal(result.source, 'clinical_data.stripe_checkout_session_id:checkout_session');
    assert.deepEqual(stripe.calls, ['cs_test_whatsapp_flow'], 'consulta a Checkout Session correta');
    results.resolveViaCheckoutSessionId = 'ok';
  }

  // 2) payment_intent do objeto retrievado pode vir como objeto expandido
  //    (não apenas string) — a Stripe pode retornar payment_intent expandido
  //    dependendo dos parâmetros de expand.
  {
    resetState();
    const stripe = fakeStripe({ retrieveResult: { payment_intent: { id: 'pi_expanded_object' } } });
    const atendimento = { id: 'at-2', dados_clinicos: { stripe_checkout_session_id: 'cs_test_expanded' } };
    const result = await resolvePaymentIntentId({ stripe, atendimento, requestedPaymentIntent: null });
    assert.equal(result.paymentIntentId, 'pi_expanded_object');
    results.resolveComPaymentIntentExpandido = 'ok';
  }

  // 3) Prioridade: se dados_clinicos.stripe_payment.payment_intent também
  //    existir (fluxo painel/Memed), ele vence e a Checkout Session nem é
  //    consultada (candidato pi_ já resolve sem chamada à API).
  {
    resetState();
    const stripe = fakeStripe({ retrieveResult: { payment_intent: 'pi_nao_deveria_ser_usado' } });
    const atendimento = {
      id: 'at-3',
      dados_clinicos: {
        stripe_payment: { payment_intent: 'pi_prioritario_do_painel' },
        stripe_checkout_session_id: 'cs_test_should_not_be_queried'
      }
    };
    const result = await resolvePaymentIntentId({ stripe, atendimento, requestedPaymentIntent: null });
    assert.equal(result.paymentIntentId, 'pi_prioritario_do_painel');
    assert.equal(result.source, 'clinical_data.stripe_payment');
    assert.deepEqual(stripe.calls, [], 'checkout.sessions.retrieve não é chamado quando já há pi_ direto');
    results.prioridadeParaStripePaymentSobreCheckoutSessionId = 'ok';
  }

  // 4) Nenhum vínculo em lugar nenhum (nem stripe_payment, nem
  //    checkout_session_id, nem payments row) — retorna null sem lançar.
  {
    resetState({ paymentRow: null });
    const stripe = fakeStripe();
    const atendimento = { id: 'at-4', dados_clinicos: {} };
    const result = await resolvePaymentIntentId({ stripe, atendimento, requestedPaymentIntent: null });
    assert.equal(result.paymentIntentId, null);
    assert.equal(result.source, null);
    results.semNenhumVinculoRetornaNull = 'ok';
  }

  // 5) checkout.sessions.retrieve falha (erro de rede/API Stripe) — não
  //    lança, apenas não resolve por essa via (aqui sem outro candidato,
  //    cai em payment_not_found do chamador).
  {
    resetState();
    const stripe = fakeStripe({ shouldThrow: true });
    const atendimento = { id: 'at-5', dados_clinicos: { stripe_checkout_session_id: 'cs_test_falha_api' } };
    const result = await resolvePaymentIntentId({ stripe, atendimento, requestedPaymentIntent: null });
    assert.equal(result.paymentIntentId, null, 'falha na consulta não derruba a função, só não resolve');
    results.falhaNaConsultaDaCheckoutSessionNaoLanca = 'ok';
  }

  // 6) session_id legado (dados_clinicos.stripe_payment.session_id) tem
  //    prioridade sobre stripe_checkout_session_id, mas ambos resolvem via
  //    checkout.sessions.retrieve quando não há pi_ direto — confirma que o
  //    candidato novo não quebra o candidato legado já existente.
  {
    resetState();
    const stripe = fakeStripe({ retrieveResult: { payment_intent: 'pi_via_session_id_legado' } });
    const atendimento = {
      id: 'at-6',
      dados_clinicos: {
        stripe_payment: { session_id: 'cs_legado' },
        stripe_checkout_session_id: 'cs_novo_nao_deveria_ser_usado'
      }
    };
    const result = await resolvePaymentIntentId({ stripe, atendimento, requestedPaymentIntent: null });
    assert.equal(result.paymentIntentId, 'pi_via_session_id_legado');
    assert.deepEqual(stripe.calls, ['cs_legado'], 'candidato legado (session_id) é tentado antes do novo (stripe_checkout_session_id)');
    results.candidatoLegadoSessionIdTemPrioridade = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
