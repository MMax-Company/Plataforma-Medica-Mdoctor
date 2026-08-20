// Teste isolado (sem rede, sem banco) para a correção de propriedade da
// conversa (2026-08-20):
//
// Bug real de produção: com uma sessão Typebot clínica ATIVA aguardando
// resposta a uma pergunta de múltipla escolha ("doença de tratamento
// contínuo?"), o paciente respondeu "3" (Dislipidemia). Havia um ticket de
// suporte residual (em_atendimento, aberto dias antes) no mesmo telefone, e
// "3" também é um EXPLICIT_SUPPORT_COMMANDS (atalho fixo "reiniciar
// chatbot"). O roteador decidia pelo atalho de suporte ANTES de checar quem
// era o dono da conversa, resetando a sessão clínica no meio da pergunta
// (startChat novo) em vez de encaminhar "3" ao continueChat.
//
// Correção: enquanto isActiveTypebotFlow(session) for true (sessão com
// typebot_session_id + expected_input_id, exceto o input inicial preso —
// stuckAtWelcomeChoice, tratamento especial pré-existente e inalterado), o
// Typebot é dono exclusivo — nenhum número, atalho de suporte ou ticket
// antigo é interpretado antes disso. Cobre 1, 2, 3, botão (texto de choice
// input) e texto livre.
const assert = require('assert');
const path = require('path');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const base = path.join(__dirname, '..', 'src', 'services', 'whatsapp-support.service.js');
const resolveFrom = (p) => path.join(path.dirname(base), p);

let atendimentos = [];
stub(resolveFrom('../store/atendimentos.store'), {
  STATUS: { WAITING: 'waiting', EM_ATENDIMENTO: 'em_atendimento', REJECTED: 'rejected' },
  createAtendimento: async (row) => ({ id: 'atd-mock', ...row }),
  listAtendimentos: async () => atendimentos,
  getAtendimento: async (id) => atendimentos.find((a) => a.id === id) || null,
  updateAtendimentoStatus: async (id, status, patch = {}) => {
    const idx = atendimentos.findIndex((a) => a.id === id);
    const updated = { ...(atendimentos[idx] || { id }), status, ...patch };
    if (idx >= 0) atendimentos[idx] = updated;
    return updated;
  }
});
stub(resolveFrom('../store/audit.store'), { createAuditLog: async () => {} });
stub(resolveFrom('./clinical-persistence.service'), { recordSupportTicket: async () => {} });
stub(resolveFrom('./post-delivery-survey.service'), { handleSurveyInbound: async () => ({ handled: false }) });
stub(resolveFrom('./admin-alert.service'), { notifyAdminAlert: () => {} });

const sessionsByPhone = new Map();
stub(resolveFrom('../store/whatsapp-sessions.store'), {
  getActiveSurveySession: () => null,
  getSessionByPhone: async (phone) => sessionsByPhone.get(phone) || null,
  clearSurveySession: async () => {},
  upsertSessionMetadata: async ({ phone, metadataPatch = {} }) => {
    const existing = sessionsByPhone.get(phone) || { id: `sess-${phone}`, typebot_session_id: null, metadata: {} };
    const merged = { ...existing, metadata: { ...(existing.metadata || {}), ...metadataPatch } };
    sessionsByPhone.set(phone, merged);
    return merged;
  },
  clearTypebotSession: async () => null
});

const supportServicePath = require.resolve(base);
delete require.cache[supportServicePath];
const support = require(base);

// Ticket residual (mesmo formato do incidente real), sempre EM_ATENDIMENTO e
// mais antigo que o início da sessão Typebot usada nos cenários abaixo.
function buildResidualSupportTicket(phone) {
  return {
    id: 'support-residual',
    status: 'em_atendimento',
    paciente_telefone: phone,
    condicao: 'suporte_whatsapp',
    dados_clinicos: {
      queue_type: 'support',
      whatsapp_support: true,
      support_sub_status: 'em_atendimento',
      opened_at: '2026-08-12T16:04:47.465Z',
      support_started_at: '2026-08-12T16:04:47.465Z'
    }
  };
}

// Sessão Typebot ativa, no meio da jornada clínica — expected_input_id
// diferente de WELCOME_CHOICE_INPUT_ID (o bug real ocorreu na pergunta
// "doença de tratamento contínuo?", bloco b156nm008xh7gb52n7w3egzn).
function buildMidJourneyTypebotSession() {
  return {
    id: 'sess-mid-journey',
    typebot_session_id: 'xs2giij32ae7p1x6vxkab67i',
    metadata: {
      typebot_expected_input_id: 'b156nm008xh7gb52n7w3egzn',
      typebot_session_started_at: '2026-08-20T18:32:06.982Z'
    }
  };
}

async function expectTypebotOwnsConversation(phone, text, label) {
  atendimentos = [buildResidualSupportTicket(phone)];
  sessionsByPhone.set(phone, buildMidJourneyTypebotSession());

  const result = await support.resolveMetaInboundRouting({ phone, text, session: sessionsByPhone.get(phone) });

  assert.equal(result.handled, false, `${label}: deve ser encaminhado ao Typebot (handled:false)`);
  assert.equal(result.action, 'typebot', `${label}: action deve ser "typebot" (continueChat), não menu/suporte/reinício`);
}

async function main() {
  const results = {};

  // Cenário real obrigatório: "3" = resposta "Dislipidemia" a uma pergunta
  // de múltipla escolha do Typebot, com ticket de suporte residual e "3"
  // sendo também um EXPLICIT_SUPPORT_COMMANDS. Deve ir para o Typebot, não
  // resetar a sessão (typebot_clean) nem cair no suporte.
  await expectTypebotOwnsConversation('5511985485777', '3', 'resposta "3" (Dislipidemia) a pergunta clínica ativa');
  results.respostaClinica3NaoReiniciaSessao = 'ok';

  // "1" e "2" também são EXPLICIT_SUPPORT_COMMANDS / opções de menu — devem
  // ir para o Typebot enquanto a sessão clínica estiver ativa.
  await expectTypebotOwnsConversation('5511985485778', '1', 'resposta "1" durante Typebot ativo');
  results.resposta1VaiParaTypebot = 'ok';

  await expectTypebotOwnsConversation('5511985485779', '2', 'resposta "2" durante Typebot ativo');
  results.resposta2VaiParaTypebot = 'ok';

  // Texto de botão (label de choice input, ex.: clique em "Vamos começar"
  // no meio da jornada, não na etapa inicial).
  await expectTypebotOwnsConversation('5511985485780', 'Vamos começar', 'texto de botão durante Typebot ativo');
  results.botaoVaiParaTypebot = 'ok';

  // Texto livre qualquer (ex.: resposta a uma pergunta aberta do Typebot).
  await expectTypebotOwnsConversation('5511985485781', 'Tenho pressão alta há 5 anos', 'texto livre durante Typebot ativo');
  results.textoLivreVaiParaTypebot = 'ok';

  // Comando explícito clássico de suporte ("ENCERRAR") — mesmo esse, com o
  // Typebot genuinamente ativo (fora do input inicial), deve ser encaminhado
  // ao Typebot, conforme a regra: "Typebot é dono exclusivo enquanto ativo".
  await expectTypebotOwnsConversation('5511985485782', 'ENCERRAR', '"ENCERRAR" durante Typebot ativo (regra de propriedade exclusiva)');
  results.encerrarDuranteTypebotAtivoVaiParaTypebot = 'ok';

  // Regressão: sem sessão Typebot ativa (nenhum typebot_session_id), ticket
  // de suporte continua funcionando normalmente (comportamento inalterado).
  {
    const phone = '5511985485783';
    atendimentos = [buildResidualSupportTicket(phone)];
    sessionsByPhone.set(phone, { id: 'sess-sem-typebot', typebot_session_id: null, metadata: {} });

    const result = await support.resolveMetaInboundRouting({ phone, text: 'ENCERRAR', session: sessionsByPhone.get(phone) });
    assert.equal(result.handled, true);
    assert.equal(result.action, 'reply');
    assert.equal(result.reply, support.SUPPORT_CLOSED_TEXT);
    results.semTypebotAtivoSuporteContinuaFuncionando = 'ok';
  }

  // Regressão: input preso exatamente no choice inicial (stuckAtWelcomeChoice)
  // mantém o tratamento especial existente para "1"/"2" (evita quebrar o
  // Typebot com "Invalid message"), inalterado por esta correção.
  {
    const phone = '5511985485784';
    atendimentos = [];
    sessionsByPhone.set(phone, {
      id: 'sess-stuck-welcome',
      typebot_session_id: 'sess-stuck',
      metadata: { typebot_expected_input_id: support.WELCOME_CHOICE_INPUT_ID }
    });

    const result = await support.resolveMetaInboundRouting({ phone, text: '1', session: sessionsByPhone.get(phone) });
    assert.equal(result.action, 'typebot_clean', 'stuckAtWelcomeChoice deve manter o tratamento especial existente, inalterado');
    results.stuckAtWelcomeChoiceInalterado = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error('FALHOU:', e.message, '\n', e.stack); process.exit(1); });
