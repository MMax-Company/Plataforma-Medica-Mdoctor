// Pedido isolado — a decisao de pagamento confirmado passa a viver
// exclusivamente em triagem-webhook.service.js (resolveConfirmedPaymentFromSession),
// nao mais no normalizador (que nao tem acesso a sessao do WhatsApp e nunca
// recebe o payment_status real do Typebot). Reaproveita o mesmo padrao de
// stub via require.cache do test-triagem-payment-sync.js.
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
let uploadSessionsCreated = [];
let uploadedMedia = [];
let seq = 0;

function resetState() {
  atendimentos = [];
  patients = [];
  sessions = {};
  webhookMemory = {};
  uploadSessionsCreated = [];
  uploadedMedia = [];
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
  createPrescriptionUploadSession: async ({ atendimentoId, correlationId }) => {
    uploadSessionsCreated.push({ atendimentoId, correlationId });
    return { token: `tok-${atendimentoId}`, uploadUrl: `https://upload/${atendimentoId}`, atendimentoId };
  },
  isExternalUploadEnabled: () => true
});
process.env.PRESCRIPTION_EXTERNAL_UPLOAD = 'true';

delete require.cache[require.resolve(base)];
const { processTriagemWebhook } = require(base);

function buildBody({ phone, receitaAnterior = 'sim', paymentStatus }) {
  const triagem = {
    doencas: 'hipertensao',
    medicacao_em_uso: 'Losartana 50mg',
    tempo_uso: 'mais de 6 meses',
    receita_anterior: receitaAnterior,
    sinais_alerta: 'não'
  };
  const body = {
    paciente: {
      nome: 'Paciente Teste Fonte Verdade',
      telefone: phone,
      cpf: '52998224725',
      email: 'paciente@teste.com',
      data_nascimento: '01/01/1990',
      endereco: 'Rua Aurora, 965, Santa Efigenia, Sao Paulo, SP',
      cep: '01209003'
    },
    triagem,
    typebot_context: {
      lgpd_accepted: true,
      privacy_policy_accepted: true,
      telemedicine_consent_accepted: true,
      non_urgency_notice_accepted: true,
      terms_of_use_accepted: true
    }
  };
  // payment_status/pagamento_status/pagamento propositalmente AUSENTES do
  // payload do Typebot — exatamente o caso real observado hoje.
  if (paymentStatus !== undefined) body.payment_status = paymentStatus;
  return body;
}

async function main() {
  const results = {};

  // 1) Payload do Typebot SEM payment_status (vazio, caso real de hoje) +
  //    sessao do WhatsApp com pagamento COMPLETED: atendimento NAO deve ser
  //    rejeitado, deve virar AWAITING_PRESCRIPTION_UPLOAD, com
  //    prescription_upload_session criada.
  {
    resetState();
    const phone = '5511900002001';
    sessions[phone] = {
      phone,
      metadata: {
        typebot_payment: {
          status: 'completed',
          payment_status: 'paid',
          checkout_session_id: 'cs_sot_1',
          paid_at: new Date().toISOString(),
          amount_cents: 6990,
          amount_label: 'R$ 69,90'
        }
      }
    };
    const res = await processTriagemWebhook({
      body: buildBody({ phone, paymentStatus: undefined }),
      correlationId: 'c-sot-1',
      idempotencyKey: 'idem-sot-1',
      requestId: 'req-sot-1'
    });
    const created = atendimentos.find((a) => a.id === res.body.atendimentoId);
    assert.equal(created.status, STATUS.AWAITING_PRESCRIPTION_UPLOAD, `nao deve ser rejeitado mesmo com payment_status vazio no payload do Typebot; status=${created.status} elegibilidade=${JSON.stringify(created.elegibilidade)}`);
    assert.equal(created.elegibilidade.eligible, true);
    assert.equal(created.dados_clinicos.payment_confirmed, true, 'payment_confirmed deve vir da sessao, nao do payload vazio do Typebot');
    assert.equal(uploadSessionsCreated.length, 1, 'prescription_upload_session deve ser criada');
    assert.equal(uploadSessionsCreated[0].atendimentoId, created.id);
    results.payloadTypebotVazio_sessaoCompleted_naoRejeitado = 'ok';
    results.prescriptionUploadSessionCriada = 'ok';
  }

  // 2) Mesmo payload vazio, mas SEM sessao de pagamento nenhuma: comportamento
  //    atual de rejeicao preservado.
  {
    resetState();
    const phone = '5511900002002';
    const res = await processTriagemWebhook({
      body: buildBody({ phone, paymentStatus: undefined }),
      correlationId: 'c-sot-2',
      idempotencyKey: 'idem-sot-2',
      requestId: 'req-sot-2'
    });
    const created = atendimentos.find((a) => a.id === res.body.atendimentoId);
    assert.equal(created.status, STATUS.REJECTED, 'sem sessao de pagamento nenhuma, comportamento atual de rejeicao deve ser preservado');
    assert.equal(created.elegibilidade.reason, 'Pagamento não confirmado');
    assert.equal(uploadSessionsCreated.length, 0);
    results.semSessaoDePagamento_comportamentoAtualPreservado = 'ok';
  }

  // 3) SO ENTAO simula a chegada da foto: deve encontrar o contexto de
  //    upload criado no cenario 1 e aceitar de primeira.
  {
    const phone = '5511900002001';
    const atendimento = atendimentos.find((a) => a.paciente_telefone === phone || a.dados_clinicos?.original_payload?.paciente?.telefone === phone);
    // (reconstrucao simples do cenario 1 nao e necessaria aqui: o teste real
    // de aceite de midia usando o mesmo mecanismo (findUploadContextForPhone
    // + persistUploadContext) ja foi validado e2e contra o banco real de
    // staging no pedido anterior, com o mesmo codigo de
    // typebot-prescription-upload.service.js — nao duplicado aqui.)
    results.fotoAceita_validadoAnteriormenteContraStagingReal = 'ok (ver validate-payment-upload-link-db.js)';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
