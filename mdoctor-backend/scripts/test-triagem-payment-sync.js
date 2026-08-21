// Pedido isolado — sincronização do pagamento confirmado (Stripe, Fase 2
// pedido 2) com o atendimento criado pela triagem (n8n). Testa
// processTriagemWebhook com as dependências de banco stubadas via
// require.cache (mesmo padrão da Fase 3), mas reaproveita os módulos REAIS
// e sem efeito colateral (eligibilityEngine, typebot-payload.mapper,
// clinical-payload-normalizer.service, triagem-nested.mapper) para exercitar
// a lógica de produção de verdade, não uma reimplementação.
require('dotenv').config();
const assert = require('assert');
const path = require('path');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const base = path.join(__dirname, '..', 'src', 'services', 'triagem-webhook.service.js');
const resolveFrom = (p) => path.join(path.dirname(base), p);

const STATUS = {
  WAITING: 'waiting',
  REJECTED: 'rejected',
  AWAITING_PRESCRIPTION_UPLOAD: 'awaiting_prescription_upload'
};

let atendimentos = [];
let patients = [];
let sessions = {};
let webhookMemory = {};
let seq = 0;

function resetState() {
  atendimentos = [];
  patients = [];
  sessions = {};
  webhookMemory = {};
}

stub(resolveFrom('../store/atendimentos.store'), {
  STATUS,
  createAtendimento: async (row) => {
    seq += 1;
    const saved = { ...row, id: row.id || `at-${seq}` };
    atendimentos.push(saved);
    return saved;
  },
  getAtendimento: async (id) => atendimentos.find((a) => a.id === id) || null,
  linkPatientToAppointment: async () => {},
  listAtendimentos: async () => atendimentos
});
stub(resolveFrom('../store/patients.store'), {
  findOrCreatePatient: async (data) => {
    const existing = patients.find((p) => p.telefone === data.whatsapp || p.telefone === data.telefone);
    if (existing) return existing;
    const row = { id: `pac-${patients.length + 1}`, telefone: data.whatsapp || data.telefone, ...data };
    patients.push(row);
    return row;
  }
});
stub(resolveFrom('../store/webhook-idempotency.store'), {
  getRememberedWebhookResult: async (key) => webhookMemory[key] || null,
  rememberWebhookResult: async (key, value) => {
    webhookMemory[key] = value;
  }
});
stub(resolveFrom('../store/whatsapp-sessions.store'), {
  getSessionByPhone: async (phone) => {
    const digits = String(phone || '').replace(/\D/g, '');
    return sessions[digits] || null;
  }
});
stub(resolveFrom('../store/audit.store'), { createAuditLog: async () => {} });
stub(resolveFrom('./clinical-persistence.service'), { persistTriagemFlow: async () => {} });
stub(resolveFrom('./prescription-upload-token.service'), {
  createPrescriptionUploadSession: async () => ({ uploadUrl: null }),
  isExternalUploadEnabled: () => false
});

delete require.cache[require.resolve(base)];
const { processTriagemWebhook } = require(base);

function buildBody({ phone, doencas = 'hipertensao', receitaAnterior = 'sim' }) {
  return {
    paciente: {
      nome: 'Paciente Teste Sync',
      telefone: phone,
      cpf: '52998224725',
      email: 'paciente@teste.com'
    },
    triagem: {
      doencas,
      medicacao_em_uso: 'Losartana 50mg',
      tempo_uso: 'mais de 30 dias',
      receita_anterior: receitaAnterior,
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

async function main() {
  const results = {};

  // 1) Sem sessão paga (pagamento não confirmado) — mantém PENDENTE.
  {
    resetState();
    const phone = '5511900000001';
    const res = await processTriagemWebhook({
      body: buildBody({ phone }),
      correlationId: 'c-1',
      idempotencyKey: 'idem-1',
      requestId: 'req-1'
    });
    assert.equal(res.status, 200);
    const created = atendimentos.find((a) => a.id === res.body.atendimentoId);
    assert.equal(created.pagamento_status, 'PENDENTE');
    results.semPagamentoConfirmadoMantemPendente = 'ok';
  }

  // 2) Sessão com pagamento confirmado (Stripe) — atendimento nasce CONFIRMADO,
  //    com os campos de rastreio registrados.
  {
    resetState();
    const phone = '5511900000002';
    const digits = phone;
    sessions[digits] = {
      phone: digits,
      metadata: {
        typebot_payment: {
          status: 'completed',
          payment_status: 'paid',
          checkout_session_id: 'cs_test_abc123',
          paid_at: '2026-07-21T08:43:03.748Z',
          stripe_event_id: 'evt_test_xyz',
          amount_cents: 4990,
          amount_label: 'R$ 49,90'
        }
      }
    };
    const res = await processTriagemWebhook({
      body: buildBody({ phone }),
      correlationId: 'c-2',
      idempotencyKey: 'idem-2',
      requestId: 'req-2'
    });
    assert.equal(res.status, 200);
    const created = atendimentos.find((a) => a.id === res.body.atendimentoId);
    assert.equal(created.pagamento_status, 'CONFIRMADO', 'webhook Stripe válido (via sessão) atualiza para confirmado');
    assert.equal(created.dados_clinicos.payment_confirmed, true);
    assert.equal(created.dados_clinicos.payment_sync_source, 'whatsapp_session');
    assert.equal(created.dados_clinicos.stripe_checkout_session_id, 'cs_test_abc123');
    assert.equal(created.dados_clinicos.stripe_paid_at, '2026-07-21T08:43:03.748Z');
    assert.equal(created.dados_clinicos.stripe_event_id, 'evt_test_xyz');
    assert.equal(created.dados_clinicos.stripe_amount_cents, 4990);
    assert.equal(created.dados_clinicos.stripe_currency, 'brl');
    results.pagamentoConfirmadoNaSessaoSincronizaAtendimento = 'ok';
    results.atendimentoNasceComStatusCorreto = 'ok';
  }

  // 3) Evento repetido (mesma idempotencyKey) não duplica nem regride o estado.
  {
    resetState();
    const phone = '5511900000003';
    sessions[phone] = {
      phone,
      metadata: { typebot_payment: { status: 'completed', payment_status: 'paid', checkout_session_id: 'cs_dup' } }
    };
    const body = buildBody({ phone });
    const res1 = await processTriagemWebhook({ body, correlationId: 'c-3a', idempotencyKey: 'idem-3', requestId: 'req-3a' });
    const res2 = await processTriagemWebhook({ body, correlationId: 'c-3b', idempotencyKey: 'idem-3', requestId: 'req-3b' });
    assert.equal(res2.body.duplicate, true);
    assert.equal(res2.body.atendimentoId, res1.body.atendimentoId);
    assert.equal(atendimentos.filter((a) => a.paciente_telefone === phone || a.dados_clinicos?.whatsapp === phone).length <= 2, true);
    assert.equal(atendimentos.filter((a) => a.id === res1.body.atendimentoId).length, 1, 'evento repetido não duplica o atendimento');
    results.eventoRepetidoNaoDuplicaNemRegride = 'ok';
  }

  // 4) Outro paciente (telefone diferente, sem sessão paga) não é afetado
  //    pela sessão paga do paciente do cenário 2 — isolamento por telefone.
  {
    resetState();
    const phoneWithoutPayment = '5511900000004'; // paciente SEM pagamento confirmado
    sessions['5511900000099'] = {
      phone: '5511900000099',
      metadata: { typebot_payment: { status: 'completed', payment_status: 'paid' } }
    }; // sessão de OUTRO paciente, não deve vazar
    const res = await processTriagemWebhook({
      body: buildBody({ phone: phoneWithoutPayment }),
      correlationId: 'c-4',
      idempotencyKey: 'idem-4',
      requestId: 'req-4'
    });
    const created = atendimentos.find((a) => a.id === res.body.atendimentoId);
    assert.equal(created.pagamento_status, 'PENDENTE', 'sessão paga de outro telefone não vaza para este atendimento');
    results.outroPacienteNaoAfetado = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
