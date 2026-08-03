// Pedido 03/08/2026 — correção combinada (uma única transação lógica) para
// três achados reais do mesmo dia:
//
// 1) linkOrRecordNativeTypebotPayment (stripe-webhook.service.js) vinculava
//    o PaymentIntent a um atendimento ANTIGO (~2h) do mesmo e-mail só porque
//    nenhum dos dois tinha stripe_payment ainda — o atendimento certo,
//    criado ~1s depois, nunca era considerado. Corrigido: a janela de
//    correspondência para um atendimento JÁ EXISTENTE ficou estrita (minutos,
//    não horas) — NATIVE_PAYMENT_EXISTING_MATCH_WINDOW_MS.
// 2) whatsapp_sessions.metadata.typebot_prescription_upload nunca era
//    atualizado pelo fluxo do bloco nativo (só o fluxo antigo de Checkout
//    Session fazia isso) — a sessão ficava presa apontando para o
//    atendimento de um teste anterior. Corrigido: processTriagemWebhook
//    grava esse contexto assim que o atendimento nasce aguardando receita
//    anterior; e findPendingUploadContext revalida o contexto cacheado
//    contra o status/telefone reais antes de confiar nele.
// 3) isPaymentConfirmedByPedido2 só reconhecia
//    whatsapp_sessions.metadata.typebot_payment — o bloco nativo nunca
//    escreve isso. Substituída por isPaymentConfirmedForUpload, que aceita
//    sessão paga (legado), payments.status=paid ou dados_clinicos.
//    stripe_payment.payment_intent — sempre restrito ao atendimentoId JÁ
//    resolvido e validado (nunca aceita pagamento de outro atendimento).
//
// Este teste exercita as funções REAIS de produção
// (stripe-webhook.service.js, typebot-prescription-upload.service.js)
// contra stores falsos em memória — sem rede, sem Supabase, sem Stripe reais.
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
  DELIVERED: 'delivered',
  AWAITING_PRESCRIPTION_UPLOAD: 'awaiting_prescription_upload'
};

let payments = [];
let paymentEvents = [];
let atendimentos = [];
let auditLogs = [];
let whatsappSessionsByPhone = {};
let seq = 0;
// Controla o cenário 8 (corrida do pagamento): quantas vezes a próxima
// chamada de findUnlinkedNativePaymentByEmail deve devolver null antes de
// consultar de verdade, simulando o INSERT ainda não visível.
let forceMissCount = 0;
let findUnlinkedNativePaymentByEmailCalls = 0;

function resetState() {
  payments = [];
  paymentEvents = [];
  atendimentos = [];
  auditLogs = [];
  whatsappSessionsByPhone = {};
  forceMissCount = 0;
  findUnlinkedNativePaymentByEmailCalls = 0;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

// ---- payments.store (fake) -------------------------------------------------
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
    findUnlinkedNativePaymentByEmailCalls += 1;
    if (forceMissCount > 0) {
      forceMissCount -= 1;
      return null;
    }
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
  async listAtendimentos(filters = {}) {
    if (!filters.status) return atendimentos;
    const selected = new Set(String(filters.status).split(','));
    return atendimentos.filter((a) => selected.has(a.status));
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

// ---- whatsapp-sessions.store (fake) ---------------------------------------
// Normaliza telefone pra dígitos puros antes de usar como chave — o store
// real (whatsapp-sessions.store.js) sempre faz isso; sem replicar aqui,
// normalizeWhatsapp() do normalizador pode devolver um formato diferente do
// dígito puro usado nos testes (ex.: com "+"), e o teste nunca encontraria
// a sessão gravada por processTriagemWebhook.
function normalizeTestPhone(value = '') {
  return String(value).replace(/\D/g, '');
}
stub(resolveFromServices('../store/whatsapp-sessions.store'), {
  async getSessionByPhone(phone) {
    return whatsappSessionsByPhone[normalizeTestPhone(phone)] || null;
  },
  async upsertSessionIdentity({ phone, metadataPatch = {} }) {
    const key = normalizeTestPhone(phone);
    const existing = whatsappSessionsByPhone[key] || { id: `sess-${key}`, phone: key, metadata: {} };
    const updated = { ...existing, metadata: { ...(existing.metadata || {}), ...metadataPatch } };
    whatsappSessionsByPhone[key] = updated;
    return updated;
  },
  // Mesmo comportamento do store real (whatsapp-sessions.store.js): zera
  // typebot_session_id e remove as chaves de estado por conversa
  // (typebot_expected_input_id, typebot_payment, typebot_prescription_upload,
  // whatsapp_menu_state) — usado pelo reset de jornada nova em whatsapp.routes.js.
  async clearTypebotSession({ sessionId, metadataPatch = {} }) {
    const entry = Object.entries(whatsappSessionsByPhone).find(([, s]) => s.id === sessionId);
    if (!entry) return null;
    const [key, existing] = entry;
    const metadata = { ...(existing.metadata || {}), ...metadataPatch };
    for (const k of ['typebot_expected_input_id', 'typebot_payment', 'typebot_prescription_upload', 'whatsapp_menu_state']) {
      delete metadata[k];
    }
    const updated = { ...existing, typebot_session_id: null, metadata };
    whatsappSessionsByPhone[key] = updated;
    return updated;
  }
});

// ---- demais dependências (mesmo padrão de test-stripe-native-payment-link) --
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
stub(resolveFromServices('../store/audit.store'), {
  async createAuditLog(entry) {
    auditLogs.push(entry);
    return entry;
  }
});
stub(resolveFromServices('../store/integration-logs.store'), {
  async createIntegrationError() {}
});
stub(resolveFromServices('./clinical-persistence.service'), {
  async persistTriagemFlow() {},
  async recordIntegrationLog() {}
});
stub(resolveFromServices('./prescription-upload-token.service'), {
  isExternalUploadEnabled: () => false,
  async ensurePrescriptionUploadSession({ atendimentoId }) {
    return { token: `tok-${atendimentoId}`, uploadUrl: `https://staging.example/upload-receita/tok-${atendimentoId}`, atendimentoId };
  },
  async resolveTokenRecord() {
    return null;
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
stub(resolveFromServices('./prescription-upload.service'), {
  async completeExternalPrescriptionUpload() {
    throw new Error('não deveria ser chamado neste teste');
  }
});
stub(resolveFromServices('./providers/meta.provider'), {
  async sendTextMessage() {
    return { providerMessageId: 'msg-fake' };
  },
  async downloadMedia() {
    return { buffer: Buffer.from('x'), mimeType: 'image/jpeg' };
  }
});

function freshRequire(filePath) {
  const resolved = require.resolve(filePath);
  delete require.cache[resolved];
  return require(resolved);
}

const stripeWebhookPath = resolveFromServices('stripe-webhook.service.js');
const triagemWebhookPath = resolveFromServices('triagem-webhook.service.js');
const uploadServicePath = resolveFromServices('typebot-prescription-upload.service.js');

const { linkOrRecordNativeTypebotPayment } = freshRequire(stripeWebhookPath);
const { processTriagemWebhook, resolvePendingNativeTypebotPayment } = freshRequire(triagemWebhookPath);
const {
  findPendingUploadContext,
  isPaymentConfirmedForUpload,
  persistUploadContext
} = freshRequire(uploadServicePath);

// Payload completo o bastante para o eligibility engine/normalizador REAIS
// (não stubados) considerarem o atendimento elegível e aguardando receita
// anterior — mesmo shape de campos de um atendimento real de produção
// (endereço estruturado, medicações, consentimentos), só variando
// telefone/e-mail por teste.
function buildBody({ phone, email }) {
  return {
    paciente: {
      nome: 'Paciente Teste Consistência',
      telefone: phone,
      cpf: '01739134150',
      email,
      data_nascimento: '09/02/1988',
      endereco: 'Rua Aurora, 965, República, São Paulo, SP',
      cep: '01209003'
    },
    triagem: {
      doencas: '1',
      medicacao_em_uso: 'Captopril — 25mg — Uma vez ao dia',
      tempo_uso: 'mais_6_meses',
      receita_anterior: 'available',
      sinais_alerta: 'NAO'
    },
    typebot_context: {
      cep: '01209003',
      address: 'Rua Aurora, 965, República, São Paulo, SP',
      address_structured: { rua: 'Rua Aurora', numero: '965', bairro: 'República', cidade: 'São Paulo', estado: 'SP' },
      doenca_cronica: '1',
      medications: [{
        dose: '25', name: 'Captopril', unit: 'mg', index: 1, label: 'Captopril',
        route: 'oral', usage: 'contínuo', posology: 'Tomar 1 unidade por via oral, uma vez ao dia.',
        raw_text: 'Captopril', frequency: '24h'
      }],
      has_previous_prescription: true,
      receita_anterior: 'available',
      lgpd_accepted: true,
      privacy_policy_accepted: true,
      telemedicine_consent_accepted: true,
      non_urgency_notice_accepted: true,
      terms_of_use_accepted: true,
      continuous_use_days: 180,
      // Bloco nativo do Typebot se autorreporta pago no próprio payload —
      // é assim que o fluxo real chega em payment_confirmed=true SEM passar
      // por whatsapp_sessions.metadata.typebot_payment (que é exclusivo do
      // fluxo antigo de Checkout Session). Não usar sessão aqui de propósito:
      // isso garantiria que resolvePendingNativeTypebotPayment (não
      // resolveConfirmedPaymentFromSession) é quem resolve o pagamento órfão.
      payment_status: 'paid'
    }
  };
}

async function main() {
  const results = {};

  // 1) Atendimento antigo (fora da janela estrita) do mesmo e-mail NUNCA é
  //    escolhido — o pagamento vira órfão, não vincula ao antigo.
  {
    resetState();
    const old = {
      id: 'at-antigo',
      paciente_email: 'ana@example.com',
      criado_em: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min atrás
      status: STATUS.AWAITING_PRESCRIPTION_UPLOAD,
      dados_clinicos: {}
    };
    atendimentos.push(old);
    const result = await linkOrRecordNativeTypebotPayment({
      paymentIntentId: 'pi_novo',
      email: 'ana@example.com',
      amountCents: 4990,
      currency: 'brl',
      eventId: 'evt_novo_1'
    });
    assert.equal(result.matched, false);
    assert.equal(result.orphan, true);
    assert.equal(old.dados_clinicos.stripe_payment, undefined, 'atendimento antigo (fora da janela) não é tocado');
    assert.equal(payments.length, 1);
    assert.equal(payments[0].appointment_id, null, 'pagamento fica órfão, não vinculado ao atendimento antigo');
    results.atendimentoAntigoForaDaJanelaNuncaEEscolhido = 'ok';
  }

  // 2) Dentro da janela estrita, um atendimento recém-criado ainda é
  //    corretamente vinculado (não quebrou o caminho feliz da ordem inversa).
  {
    resetState();
    const recent = {
      id: 'at-recente',
      paciente_email: 'bruno@example.com',
      criado_em: new Date(Date.now() - 5000).toISOString(), // 5s atrás
      status: STATUS.WAITING,
      motivo_decisao: null,
      medico_id: null,
      dados_clinicos: {}
    };
    atendimentos.push(recent);
    const result = await linkOrRecordNativeTypebotPayment({
      paymentIntentId: 'pi_recente',
      email: 'bruno@example.com',
      amountCents: 4990,
      currency: 'brl',
      eventId: 'evt_recente_1'
    });
    assert.equal(result.matched, true);
    assert.equal(result.atendimentoId, 'at-recente');
    const updatedRecent = atendimentos.find((a) => a.id === 'at-recente');
    assert.equal(updatedRecent.dados_clinicos.stripe_payment.payment_intent, 'pi_recente');
    results.atendimentoDentroDaJanelaEstritaContinuaSendoVinculado = 'ok';
  }

  // 3) Webhook antes do atendimento existir + atendimento nascendo segundos
  //    depois: processTriagemWebhook grava dados_clinicos.stripe_payment E
  //    atualiza whatsapp_sessions.metadata.typebot_prescription_upload para
  //    o atendimento novo.
  {
    resetState();
    await linkOrRecordNativeTypebotPayment({
      paymentIntentId: 'pi_orfao_consumido',
      email: 'carla@example.com',
      amountCents: 4990,
      currency: 'brl',
      eventId: 'evt_orfao_1'
    });
    assert.equal(payments.length, 1);
    assert.equal(payments[0].appointment_id, null);

    const res = await processTriagemWebhook({
      body: buildBody({ phone: '5511922222222', email: 'Carla@Example.com' }),
      correlationId: 'c-1',
      idempotencyKey: 'idem-1',
      requestId: 'req-1'
    });
    const created = atendimentos.find((a) => a.id === res.body.atendimentoId);
    assert.equal(created.dados_clinicos.stripe_payment.payment_intent, 'pi_orfao_consumido');
    assert.equal(payments[0].appointment_id, created.id);

    const session = whatsappSessionsByPhone['5511922222222'];
    assert.ok(session, 'sessão do telefone foi criada/atualizada');
    assert.equal(
      session.metadata.typebot_prescription_upload.atendimento_id,
      created.id,
      'contexto de upload da sessão aponta para o atendimento novo, não para nenhum antigo'
    );
    results.webhookAntesDoAtendimentoENovoContextoDeUploadGravado = 'ok';
  }

  // 4) Contexto de sessão apontando para atendimento ANTIGO já rejeitado é
  //    substituído — findPendingUploadContext ignora o cache e encontra o
  //    atendimento atual (aberto, mesmo telefone) pela busca por telefone.
  {
    resetState();
    const oldRejected = {
      id: 'at-velho-rejeitado',
      paciente_telefone: '5511933333333',
      status: STATUS.REJECTED,
      dados_clinicos: {}
    };
    const current = {
      id: 'at-atual',
      paciente_telefone: '5511933333333',
      status: STATUS.AWAITING_PRESCRIPTION_UPLOAD,
      dados_clinicos: { prescription_upload_session: { token: 'tok-atual', upload_url: 'https://x/tok-atual' } }
    };
    atendimentos.push(oldRejected, current);
    const staleSession = {
      phone: '5511933333333',
      metadata: {
        typebot_prescription_upload: {
          atendimento_id: 'at-velho-rejeitado',
          token: 'tok-velho',
          upload_url: 'https://x/tok-velho'
        }
      }
    };
    const context = await findPendingUploadContext('5511933333333', { whatsappSession: staleSession });
    assert.equal(context.atendimentoId, 'at-atual', 'ignora o contexto velho e resolve o atendimento aberto atual');
    results.contextoDeSessaoAntigoRejeitadoESubstituido = 'ok';
  }

  // 4b) Contexto de sessão válido (atendimento aberto, mesmo telefone) é
  //     usado diretamente, sem cair na busca por telefone.
  {
    resetState();
    const current = {
      id: 'at-valido',
      paciente_telefone: '5511944444444',
      status: STATUS.AWAITING_PRESCRIPTION_UPLOAD,
      dados_clinicos: {}
    };
    atendimentos.push(current);
    const validSession = {
      phone: '5511944444444',
      metadata: {
        typebot_prescription_upload: {
          atendimento_id: 'at-valido',
          token: 'tok-valido',
          upload_url: 'https://x/tok-valido'
        }
      }
    };
    const context = await findPendingUploadContext('5511944444444', { whatsappSession: validSession });
    assert.equal(context.atendimentoId, 'at-valido');
    assert.equal(context.token, 'tok-valido');
    results.contextoDeSessaoValidoUsadoDireto = 'ok';
  }

  // 5) Upload aceito quando payments.status = paid vinculado ao atendimento
  //    atual, mesmo sem whatsapp_sessions.metadata.typebot_payment.
  {
    resetState();
    payments.push({ id: 'pay-x', appointment_id: 'at-pago', status: 'paid' });
    const confirmed = await isPaymentConfirmedForUpload({ metadata: {} }, 'at-pago', {
      getAtendimento: async () => ({ dados_clinicos: {} }),
      findPaymentByAppointment: async (id) => payments.find((p) => p.appointment_id === id) || null
    });
    assert.equal(confirmed, true);
    results.uploadAceitoQuandoPaymentsStatusPaid = 'ok';
  }

  // 5b) Upload aceito quando dados_clinicos.stripe_payment.payment_intent
  //     está presente no atendimento atual, mesmo sem linha em payments.
  {
    const confirmed = await isPaymentConfirmedForUpload({ metadata: {} }, 'at-com-stripe-payment', {
      getAtendimento: async () => ({ dados_clinicos: { stripe_payment: { payment_intent: 'pi_x' } } }),
      findPaymentByAppointment: async () => null
    });
    assert.equal(confirmed, true);
    results.uploadAceitoQuandoStripePaymentPresenteNoAtendimento = 'ok';
  }

  // 6) Upload REJEITADO quando o pagamento pertence a outro atendimento —
  //    findPaymentByAppointment/getAtendimento são sempre consultados só
  //    pelo atendimentoId atual, nunca por e-mail/telefone globalmente.
  {
    const confirmed = await isPaymentConfirmedForUpload({ metadata: {} }, 'at-sem-pagamento-proprio', {
      getAtendimento: async (id) => {
        assert.equal(id, 'at-sem-pagamento-proprio');
        return { dados_clinicos: {} };
      },
      findPaymentByAppointment: async (id) => {
        assert.equal(id, 'at-sem-pagamento-proprio');
        return null; // o pagamento "de outro atendimento" nunca é nem consultado por este id
      }
    });
    assert.equal(confirmed, false, 'não aceita pagamento vinculado a outro atendimento');
    results.uploadRejeitadoQuandoPagamentoDeOutroAtendimento = 'ok';
  }

  // 7) Idempotência: reentrega do MESMO evento Stripe não duplica o payment
  //    nem re-tenta vincular a um segundo atendimento.
  {
    resetState();
    const first = await linkOrRecordNativeTypebotPayment({
      paymentIntentId: 'pi_idem',
      email: 'duda@example.com',
      amountCents: 4990,
      currency: 'brl',
      eventId: 'evt_idem_x'
    });
    assert.equal(first.orphan, true);
    const second = await linkOrRecordNativeTypebotPayment({
      paymentIntentId: 'pi_idem',
      email: 'duda@example.com',
      amountCents: 4990,
      currency: 'brl',
      eventId: 'evt_idem_x'
    });
    assert.equal(second.duplicate, true);
    assert.equal(payments.length, 1, 'reentrega do mesmo evento não cria um segundo payment');
    results.idempotenciaNaReentregaDoWebhook = 'ok';
  }

  // 8) Corrida real do nº 1061: o pagamento órfão só fica visível na 2ª
  //    consulta (ex.: commit ainda não propagado na 1ª tentativa) —
  //    resolvePendingNativeTypebotPayment tenta de novo e encontra, sem
  //    ampliar o critério de busca (mesmo e-mail/valor/moeda).
  {
    resetState();
    await linkOrRecordNativeTypebotPayment({
      paymentIntentId: 'pi_corrida',
      email: 'erika@example.com',
      amountCents: 4990,
      currency: 'brl',
      eventId: 'evt_corrida_1'
    });
    // O pagamento já está no store (linha acima) — força a 1ª consulta de
    // resolvePendingNativeTypebotPayment a "não ver" ainda, simulando o
    // instante em que o INSERT do webhook não propagou a tempo da triagem.
    forceMissCount = 1;
    const callsBefore = findUnlinkedNativePaymentByEmailCalls;
    const resolved = await resolvePendingNativeTypebotPayment('erika@example.com');
    assert.ok(findUnlinkedNativePaymentByEmailCalls - callsBefore >= 2, 'precisou de mais de uma tentativa para encontrar o pagamento');
    assert.ok(resolved, 'encontrou o pagamento órfão na reconsulta');
    assert.equal(resolved.payment_intent, 'pi_corrida');
    results.pagamentoOrfaoEncontradoNaReconsulta = 'ok';
  }

  // 9) Nova jornada (sessão sem journey_started_at) com sessão antiga que
  //    ainda tem typebot_session_id/typebot_payment/typebot_prescription_upload
  //    de um teste anterior — clearTypebotSession (chamado pelo webhook do
  //    WhatsApp ao detectar jornada nova) some com TODO esse estado, para a
  //    jornada nova nunca herdar variáveis/ponteiros de uma triagem anterior.
  {
    resetState();
    const { clearTypebotSession } = require(resolveFromServices('../store/whatsapp-sessions.store'));
    whatsappSessionsByPhone['5511955555555'] = {
      id: 'sess-antiga',
      phone: '5511955555555',
      typebot_session_id: 'typebot-sessao-de-horas-atras',
      metadata: {
        typebot_expected_input_id: 'blk_algum_input_antigo',
        typebot_payment: { payment_status: 'paid', payment_intent: 'pi_antigo' },
        typebot_prescription_upload: { atendimento_id: 'at-antigo', token: 'tok-antigo' },
        whatsapp_menu_state: 'algum_estado_antigo',
        journey_started_at: null
      }
    };
    await clearTypebotSession({ sessionId: 'sess-antiga' });
    const cleared = whatsappSessionsByPhone['5511955555555'];
    assert.equal(cleared.typebot_session_id, null, 'typebot_session_id zerado — próxima mensagem começa conversa nova no Typebot');
    assert.equal(cleared.metadata.typebot_payment, undefined, 'sem pagamento antigo residual');
    assert.equal(cleared.metadata.typebot_prescription_upload, undefined, 'sem ponteiro de upload antigo residual');
    assert.equal(cleared.metadata.typebot_expected_input_id, undefined, 'sem estado de input antigo residual');
    results.novaJornadaLimpaEstadoDeTypebotAntigo = 'ok';
  }

  // 10) Achado real nº 1065: typebot_context.chronic_condition chega
  //     recalculado pelo n8n (sem o mapeamento numérico "1"→hipertensão) como
  //     "renovacao_receita", enquanto a triagem aninhada trouxe doencas: "1"
  //     (válido). typebot_context não pode sobrescrever isso — o atendimento
  //     deve nascer elegível (não rejeitado por "consulta_presencial").
  {
    resetState();
    const body = buildBody({ phone: '5511926260111', email: 'max@example.com' });
    body.typebot_context.chronic_condition = 'renovacao_receita';
    delete body.typebot_context.doenca_cronica;

    const res = await processTriagemWebhook({
      body,
      correlationId: 'c-chronic',
      idempotencyKey: 'idem-chronic',
      requestId: 'req-chronic'
    });
    const created = atendimentos.find((a) => a.id === res.body.atendimentoId);
    assert.ok(created, 'atendimento foi criado');
    assert.equal(
      created.dados_clinicos.normalized_payload.chronic_condition,
      'hipertensao',
      'chronic_condition da triagem aninhada (doencas: "1") não pode ser sobrescrito pelo typebot_context'
    );
    assert.notEqual(created.status, STATUS.REJECTED, 'não pode nascer rejeitado por sobrescrita do typebot_context');
    assert.notEqual(
      created.dados_clinicos.decision_meta.reasonCode,
      'consulta_presencial',
      'reasonCode não pode ser consulta_presencial neste cenário'
    );
    results.typebotContextNaoSobrescreveChronicCondition = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
