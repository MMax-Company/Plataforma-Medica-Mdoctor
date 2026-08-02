// Pedido 02/08/2026 (vínculo PaymentIntent do bloco NATIVO do Typebot):
// achado real do dia — o bloco de pagamento "payment input" do Typebot
// (Stripe conectado direto no bot, credencial "Doctor Prescreve Plataforma")
// cria o PaymentIntent sem metadata e sem atendimento_id (confirmado direto
// na Stripe real: metadata sempre {}, shipping sempre null). O primeiro
// estorno automático de reprovação não encontrou o pagamento por isso e
// precisou de recuperação manual (ver docs/PROJECT_MEMORY.md §8).
//
// Este teste exercita as funções REAIS de produção
// (stripe-webhook.service.js, triagem-webhook.service.js,
// stripe-refund.service.js) contra um payments.store/atendimentos.store
// falsos em memória compartilhada (mesmo padrão de
// test-triagem-payment-sync.js e test-stripe-refund-checkout-session-
// resolution.js) — sem rede, sem Supabase, sem Stripe reais.
require('dotenv').config();
const assert = require('assert');
const path = require('path');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const servicesDir = path.join(__dirname, '..', 'src', 'services');
const resolveFromServices = (p) => path.join(servicesDir, p);

const STATUS = {
  WAITING: 'waiting',
  REJECTED: 'rejected',
  AWAITING_PRESCRIPTION_UPLOAD: 'awaiting_prescription_upload'
};

let payments = [];
let paymentEvents = [];
let atendimentos = [];
let auditLogs = [];
let seq = 0;

function resetState() {
  payments = [];
  paymentEvents = [];
  atendimentos = [];
  auditLogs = [];
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

// ---- payments.store (fake) — mesma forma da tabela real, em memória -------
stub(resolveFromServices('../store/payments.store'), {
  async recordStripePaymentEvent({ appointmentId = null, patientId = null, providerEventId, eventType, amountCents = null, currency = 'BRL', payload = {} }) {
    if (providerEventId) {
      const existingEvent = paymentEvents.find((e) => e.provider_event_id === providerEventId);
      if (existingEvent) {
        return { duplicate: true, payment: payments.find((p) => p.id === existingEvent.payment_id) || null, paymentEvent: existingEvent };
      }
    }
    seq += 1;
    const payment = {
      id: `pay-${seq}`,
      appointment_id: appointmentId,
      patient_id: patientId,
      provider: 'stripe',
      external_id: payload.session_id || payload.payment_intent || providerEventId,
      amount_cents: amountCents,
      currency: String(currency || 'BRL').toUpperCase(),
      status: 'paid',
      metadata: payload,
      paid_at: new Date().toISOString()
    };
    payments.push(payment);
    const paymentEvent = { id: `pe-${paymentEvents.length + 1}`, payment_id: payment.id, event_type: eventType, provider_event_id: providerEventId, payload };
    paymentEvents.push(paymentEvent);
    return { duplicate: false, payment, paymentEvent };
  },
  async findPaymentByAppointment(appointmentId) {
    if (!appointmentId) return null;
    return payments.filter((p) => p.appointment_id === appointmentId).sort((a, b) => (a.paid_at < b.paid_at ? 1 : -1))[0] || null;
  },
  async findUnlinkedNativePaymentByEmail({ email, amountCents, currency = 'BRL', sinceIso = null }) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !amountCents) return null;
    const candidates = payments.filter(
      (p) =>
        p.appointment_id === null &&
        p.amount_cents === amountCents &&
        p.currency === String(currency || 'BRL').toUpperCase() &&
        normalizeEmail(p.metadata?.receipt_email) === normalizedEmail &&
        (!sinceIso || p.paid_at >= sinceIso)
    );
    return candidates.sort((a, b) => (a.paid_at < b.paid_at ? 1 : -1))[0] || null;
  },
  async linkPaymentToAppointment(paymentId, appointmentId, patientId = null) {
    const payment = payments.find((p) => p.id === paymentId);
    if (!payment) return null;
    payment.appointment_id = appointmentId;
    if (patientId) payment.patient_id = patientId;
    return payment;
  },
  async markPaymentRefunded(paymentId) {
    const payment = payments.find((p) => p.id === paymentId);
    if (payment) payment.status = 'refunded';
    return payment || null;
  },
  async findPaymentEventByProviderId(_provider, providerEventId) {
    const paymentEvent = paymentEvents.find((e) => e.provider_event_id === providerEventId);
    if (!paymentEvent) return null;
    return { ...paymentEvent, payments: payments.find((p) => p.id === paymentEvent.payment_id) || null };
  },
  async deletePaymentEvent() {}
});

// ---- atendimentos.store (fake) --------------------------------------------
stub(resolveFromServices('../store/atendimentos.store'), {
  STATUS,
  async createAtendimento(row) {
    seq += 1;
    const saved = { ...row, id: row.id || `at-${seq}` };
    atendimentos.push(saved);
    return saved;
  },
  async getAtendimento(id) {
    return atendimentos.find((a) => a.id === id) || null;
  },
  async listAtendimentos() {
    return atendimentos;
  },
  async linkPatientToAppointment() {
    return null;
  },
  async updateAtendimentoStatus(id, status, meta = {}) {
    const idx = atendimentos.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    const current = atendimentos[idx];
    const updated = {
      ...current,
      status,
      motivo_decisao: meta.motivo !== undefined ? meta.motivo : current.motivo_decisao ?? null,
      medico_id: meta.medicoId !== undefined ? meta.medicoId : current.medico_id ?? null,
      ...(meta.dados_clinicos ? { dados_clinicos: meta.dados_clinicos } : {}),
      ...(meta.pagamento_status !== undefined ? { pagamento_status: meta.pagamento_status } : {})
    };
    atendimentos[idx] = updated;
    return updated;
  }
});

// ---- demais dependências (mesmo padrão de test-triagem-payment-sync.js) --
stub(resolveFromServices('../store/patients.store'), {
  async findOrCreatePatient(data) {
    return { id: `pac-${data.whatsapp || data.telefone || 'x'}` };
  }
});
stub(resolveFromServices('../store/webhook-idempotency.store'), {
  async getRememberedWebhookResult() {
    return null;
  },
  async rememberWebhookResult() {}
});
stub(resolveFromServices('../store/whatsapp-sessions.store'), {
  async getSessionByPhone() {
    return null;
  }
});
stub(resolveFromServices('../store/audit.store'), {
  async createAuditLog(entry) {
    auditLogs.push(entry);
    return entry;
  }
});
stub(resolveFromServices('./clinical-persistence.service'), {
  async persistTriagemFlow() {},
  async recordIntegrationLog() {}
});
stub(resolveFromServices('./prescription-upload-token.service'), {
  isExternalUploadEnabled: () => false,
  async ensurePrescriptionUploadSession() {
    return { token: null, uploadUrl: null };
  }
});
stub(resolveFromServices('./typebot-payment-link.service'), {
  async applyCheckoutWebhook() {
    return { ok: false, code: 'NOT_USED_IN_THIS_TEST' };
  },
  async completePaymentByToken() {
    return { ok: false };
  },
  async findSessionByPaymentIntentId() {
    return null;
  }
});

function freshRequire(filePath) {
  const resolved = require.resolve(filePath);
  delete require.cache[resolved];
  return require(resolved);
}

const stripeWebhookPath = resolveFromServices('stripe-webhook.service.js');
const triagemWebhookPath = resolveFromServices('triagem-webhook.service.js');
const stripeRefundPath = resolveFromServices('stripe-refund.service.js');

const { linkOrRecordNativeTypebotPayment, handleTypebotPaymentWebhook } = freshRequire(stripeWebhookPath);
const { processTriagemWebhook } = freshRequire(triagemWebhookPath);
const { resolvePaymentIntentId } = freshRequire(stripeRefundPath);

function buildBody({ phone, email }) {
  return {
    paciente: {
      nome: 'Paciente Teste Pagamento Nativo',
      telefone: phone,
      cpf: '52998224725',
      email
    },
    triagem: {
      doencas: 'hipertensao',
      medicacao_em_uso: 'Losartana 50mg',
      tempo_uso: 'mais de 30 dias',
      receita_anterior: 'sim',
      sinais_alerta: 'não'
    },
    typebot_context: {
      lgpd_accepted: true,
      privacy_policy_accepted: true,
      telemedicine_consent_accepted: true,
      non_urgency_notice_accepted: true,
      terms_of_use_accepted: true
    }
  };
}

function nativePaymentIntentSucceededEvent({ id, paymentIntentId, email, amountCents = 4990, currency = 'brl', metadata = {} }) {
  return {
    id,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: paymentIntentId,
        amount_received: amountCents,
        currency,
        receipt_email: email,
        metadata
      }
    }
  };
}

async function main() {
  const results = {};

  // 1) Webhook chega ANTES do atendimento existir: grava payment "órfão"
  //    (appointment_id null) — nunca cria nem toca atendimento.
  {
    resetState();
    const result = await linkOrRecordNativeTypebotPayment({
      paymentIntentId: 'pi_native_orfao',
      email: 'ana@example.com',
      amountCents: 4990,
      currency: 'brl',
      eventId: 'evt_native_1'
    });
    assert.equal(result.matched, false);
    assert.equal(result.orphan, true);
    assert.equal(payments.length, 1);
    assert.equal(payments[0].appointment_id, null);
    assert.equal(payments[0].external_id, 'pi_native_orfao');
    assert.equal(payments[0].metadata.receipt_email, 'ana@example.com');
    assert.equal(atendimentos.length, 0, 'não cria nem altera nenhum atendimento');
    results.webhookAntesDoAtendimentoGravaOrfao = 'ok';
  }

  // 2) Reentrega do MESMO evento Stripe (event.id) antes da triagem — não
  //    duplica o payment (idempotência por provider_event_id).
  {
    const result = await linkOrRecordNativeTypebotPayment({
      paymentIntentId: 'pi_native_orfao',
      email: 'ana@example.com',
      amountCents: 4990,
      currency: 'brl',
      eventId: 'evt_native_1'
    });
    assert.equal(result.duplicate, true);
    assert.equal(payments.length, 1, 'reentrega do mesmo evento não cria um segundo payment');
    results.reentregaDoMesmoEventoNaoDuplica = 'ok';
  }

  // 3) processTriagemWebhook cria o atendimento com o MESMO e-mail (case
  //    diferente, para provar normalização) — consome o payment órfão:
  //    dados_clinicos.stripe_payment fica com o payment_intent real, e o
  //    payments.appointment_id passa a apontar para o atendimento criado.
  {
    const res = await processTriagemWebhook({
      body: buildBody({ phone: '5511911111111', email: 'Ana@Example.com' }),
      correlationId: 'c-native-1',
      idempotencyKey: 'idem-native-1',
      requestId: 'req-native-1'
    });
    assert.equal(res.status, 200);
    const created = atendimentos.find((a) => a.id === res.body.atendimentoId);
    assert.ok(created, 'atendimento foi criado');
    assert.equal(created.dados_clinicos.payment_sync_source, 'stripe_native_payment_block');
    assert.equal(created.dados_clinicos.stripe_payment.payment_intent, 'pi_native_orfao');
    assert.equal(payments[0].appointment_id, created.id, 'payment orfao fica vinculado ao atendimento criado');
    results.triagemConsomeOPaymentOrfaoPeloEmail = 'ok';

    // 3b) Prova de fogo: o estorno automático (stripe-refund.service.js)
    //     agora RESOLVE o payment_intent sem precisar de nenhuma chamada à
    //     Stripe (candidato de maior prioridade, clinical_data.stripe_payment)
    //     — exatamente o que faltava no incidente real de 02/08/2026.
    const resolved = await resolvePaymentIntentId({ stripe: null, atendimento: created, requestedPaymentIntent: null });
    assert.equal(resolved.paymentIntentId, 'pi_native_orfao');
    assert.equal(resolved.source, 'clinical_data.stripe_payment');
    results.estornoAutomaticoResolveOPaymentIntentSemChamarStripe = 'ok';
  }

  // 4) Ordem inversa: atendimento já existe (mesmo e-mail, ainda sem
  //    stripe_payment) quando o webhook chega — vincula na hora, sem deixar
  //    órfão, e preserva motivo_decisao/medico_id existentes.
  {
    resetState();
    atendimentos.push({
      id: 'at-existente',
      paciente_email: 'bruno@example.com',
      criado_em: new Date().toISOString(),
      status: STATUS.WAITING,
      motivo_decisao: 'Elegível — triagem automática',
      medico_id: null,
      dados_clinicos: {}
    });
    const result = await linkOrRecordNativeTypebotPayment({
      paymentIntentId: 'pi_native_direto',
      email: 'bruno@example.com',
      amountCents: 4990,
      currency: 'brl',
      eventId: 'evt_native_2'
    });
    assert.equal(result.matched, true);
    assert.equal(result.atendimentoId, 'at-existente');
    const updated = atendimentos.find((a) => a.id === 'at-existente');
    assert.equal(updated.dados_clinicos.stripe_payment.payment_intent, 'pi_native_direto');
    assert.equal(updated.motivo_decisao, 'Elegível — triagem automática', 'não apaga motivo_decisao existente');
    assert.equal(payments.length, 1);
    assert.equal(payments[0].appointment_id, 'at-existente', 'não fica órfão quando o atendimento já existe');
    assert.ok(auditLogs.some((log) => log.action === 'stripe_native_payment_linked'));
    results.ordemInversaVinculaNaHoraSemDeixarOrfao = 'ok';
  }

  // 5) Nunca intercepta um PaymentIntent que já tem vínculo explícito
  //    (painel/Memed) — deixa cair no fluxo por atendimento_id existente.
  {
    resetState();
    const event = nativePaymentIntentSucceededEvent({
      id: 'evt_native_3',
      paymentIntentId: 'pi_painel_memed',
      email: 'painel@example.com',
      metadata: { atendimento_id: 'at-painel-1' }
    });
    const result = await handleTypebotPaymentWebhook(event);
    assert.equal(result, null, 'não intercepta — fluxo painel/Memed resolve por metadata.atendimento_id');
    assert.equal(payments.length, 0);
    results.naoInterceptaPaymentIntentComVinculoExplicito = 'ok';
  }

  // 6) Valor/moeda diferentes da cobrança oficial (ex.: preço antigo
  //    R$ 69,90, ou moeda diferente) — ignorado, sem criar payment.
  {
    resetState();
    const event = nativePaymentIntentSucceededEvent({
      id: 'evt_native_4',
      paymentIntentId: 'pi_valor_diferente',
      email: 'outro@example.com',
      amountCents: 6990
    });
    const result = await handleTypebotPaymentWebhook(event);
    assert.equal(result, null);
    assert.equal(payments.length, 0);
    results.valorDiferenteDaCobrancaOficialEIgnorado = 'ok';
  }

  // 7) Sem receipt_email (nunca deveria acontecer — Email é obrigatório
  //    antes do bloco de pagamento — mas não pode derrubar o webhook).
  {
    resetState();
    const result = await linkOrRecordNativeTypebotPayment({
      paymentIntentId: 'pi_sem_email',
      email: '',
      amountCents: 4990,
      currency: 'brl',
      eventId: 'evt_native_5'
    });
    assert.equal(result.ignored, true);
    assert.equal(result.reason, 'missing_email');
    assert.equal(payments.length, 0);
    results.semEmailNaoDerrubaEIgnorado = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
