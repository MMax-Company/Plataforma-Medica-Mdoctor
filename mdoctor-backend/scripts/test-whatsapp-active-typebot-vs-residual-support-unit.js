// Teste isolado (sem rede, sem banco) para a correção de 19/08/2026:
//
// GAP identificado na investigação do teste real de WhatsApp de 19/08/2026
// (ver docs/PROJECT_MEMORY.md seção 11): quando existe uma sessão Typebot
// clínica ATIVA e válida (typebot_session_id + expected_input_id/fluxo
// ativo), um ticket de suporte antigo em `waiting`/`em_atendimento` não pode
// sequestrar as respostas destinadas ao Typebot. Reproduzido em produção com
// o ticket `33c77460-fcd5-4e62-afe1-13d3a9a270e9` (aberto/atendido em
// 11-12/08/2026, nunca finalizado): o cenário
//   Oi → 1 → startChat → "Vamos começar" → continueChat
// parava exatamente no "Vamos começar", respondido com a mensagem de espera
// do suporte em vez de seguir para o Typebot.
//
// A correção distingue ticket "residual" de suporte "atual/intencional" por
// freschura: compara `typebot_session_started_at` (novo marcador, gravado só
// no startChat) contra `support_started_at`/`opened_at` do ticket. Ticket
// mais antigo que o início da sessão Typebot atual perde a prioridade;
// ticket igual/mais recente mantém a prioridade de sempre. Comandos
// explícitos de gestão do suporte (ENCERRAR/0, 3/CHATBOT, 1/AGUARDAR) e o
// estado `awaiting_patient_decision` continuam absolutos, independente de
// freschura. `awaiting_menu_choice` (7a94d2b) continua acima de tudo.
const assert = require('assert');
const path = require('path');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const base = path.join(__dirname, '..', 'src', 'services', 'whatsapp-support.service.js');
const resolveFrom = (p) => path.join(path.dirname(base), p);

let atendimentos = [];
let createdSupportTickets = 0;
let closedSupportTickets = 0;
let statusUpdates = [];
stub(resolveFrom('../store/atendimentos.store'), {
  STATUS: { WAITING: 'waiting', EM_ATENDIMENTO: 'em_atendimento', REJECTED: 'rejected' },
  createAtendimento: async (row) => {
    createdSupportTickets += 1;
    return { id: 'atd-mock', ...row };
  },
  listAtendimentos: async () => atendimentos,
  getAtendimento: async (id) => atendimentos.find((a) => a.id === id) || null,
  updateAtendimentoStatus: async (id, status, patch = {}) => {
    statusUpdates.push({ id, status, patch });
    const idx = atendimentos.findIndex((a) => a.id === id);
    const updated = { ...(atendimentos[idx] || { id }), status, ...patch };
    if (idx >= 0) atendimentos[idx] = updated;
    if (patch?.dados_clinicos?.support_closed_at) closedSupportTickets += 1;
    return updated;
  }
});
stub(resolveFrom('../store/audit.store'), { createAuditLog: async () => {} });
stub(resolveFrom('./clinical-persistence.service'), { recordSupportTicket: async () => {} });
stub(resolveFrom('./post-delivery-survey.service'), { handleSurveyInbound: async () => ({ handled: false }) });
stub(resolveFrom('./admin-alert.service'), { notifyAdminAlert: () => {} });

// Sessões em memória com o mesmo contrato do store real
// (whatsapp-sessions.store.js) — getSessionByPhone lê, upsertSessionMetadata
// e clearTypebotSession fazem merge/limpeza raso no metadata existente.
const sessionsByPhone = new Map();
const TYPEBOT_METADATA_KEYS = [
  'typebot_expected_input_id',
  'typebot_payment',
  'typebot_prescription_upload',
  'whatsapp_menu_state',
  'post_delivery_support_available',
  'typebot_session_started_at'
];
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
  clearTypebotSession: async ({ sessionId }) => {
    for (const [phone, session] of sessionsByPhone.entries()) {
      if (session.id !== sessionId) continue;
      const metadata = { ...(session.metadata || {}) };
      for (const key of TYPEBOT_METADATA_KEYS) delete metadata[key];
      const cleared = { ...session, typebot_session_id: null, metadata };
      sessionsByPhone.set(phone, cleared);
      return cleared;
    }
    return null;
  }
});

const supportServicePath = require.resolve(base);
delete require.cache[supportServicePath];
const support = require(base);

// Ticket real que causou o incidente (mascarado): aberto 11/08, atendente
// começou a atender 12/08, nunca finalizado — exatamente o formato
// encontrado em produção (appointments.id = 33c77460-...).
function buildOldSupportTicket(phone, { supportStartedAt = '2026-08-12T16:04:47.465Z', openedAt = '2026-08-11T18:13:04.052Z', includeSupportStartedAt = true } = {}) {
  return {
    id: 'support-antigo-em-atendimento',
    status: 'em_atendimento',
    paciente_telefone: phone,
    condicao: 'suporte_whatsapp',
    dados_clinicos: {
      queue_type: 'support',
      whatsapp_support: true,
      support_sub_status: 'em_atendimento',
      opened_at: openedAt,
      ...(includeSupportStartedAt ? { support_started_at: supportStartedAt } : {})
    }
  };
}

function buildActiveTypebotSession({ typebotSessionStartedAt } = {}) {
  return {
    id: 'sess-active-typebot',
    typebot_session_id: 'tc261ys43cduvnepk340t6lp',
    metadata: {
      typebot_expected_input_id: support.WELCOME_CHOICE_INPUT_ID, // "Vamos começar"
      ...(typebotSessionStartedAt ? { typebot_session_started_at: typebotSessionStartedAt } : {})
    }
  };
}

async function main() {
  const results = {};

  // ── Cenário real obrigatório ────────────────────────────────────────────
  // Oi → 1 → startChat já aconteceram (fora do escopo deste teste, que foca
  // no roteamento); aqui simulamos exatamente o passo que falhava: a sessão
  // Typebot já está ativa (startChat concluído, aguardando "Vamos começar")
  // e é MAIS RECENTE que o ticket antigo em_atendimento.
  {
    const phone = '5511985485777'; // mesmo formato do telefone real do incidente
    atendimentos = [buildOldSupportTicket(phone)]; // support_started_at: 12/08
    sessionsByPhone.set(phone, buildActiveTypebotSession({ typebotSessionStartedAt: '2026-08-19T08:53:38.544Z' }));

    const result = await support.resolveMetaInboundRouting({
      phone,
      text: 'Vamos começar',
      session: sessionsByPhone.get(phone)
    });

    assert.equal(result.handled, false, 'cenário real: "Vamos começar" deve cair para o Typebot (continueChat), não ser interceptado pelo ticket antigo');
    assert.equal(result.action, 'typebot');
    results.cenarioReal_VamosComecarChegaAoContinueChat = 'ok';
  }

  // ── Inverso 1: suporte realmente atual continua tendo prioridade ───────
  // Ticket com support_started_at MAIS RECENTE que a sessão Typebot — o
  // atendente começou a atender DEPOIS do startChat (ou o ticket é de fato o
  // atendimento em andamento agora). Suporte deve continuar dono da resposta.
  {
    const phone = '5511985480010';
    atendimentos = [buildOldSupportTicket(phone, { supportStartedAt: '2026-08-19T09:00:00.000Z' })];
    sessionsByPhone.set(phone, buildActiveTypebotSession({ typebotSessionStartedAt: '2026-08-19T08:53:38.544Z' }));

    const result = await support.resolveMetaInboundRouting({
      phone,
      text: 'Vamos começar',
      session: sessionsByPhone.get(phone)
    });

    assert.equal(result.handled, true);
    assert.equal(result.action, 'reply');
    assert.equal(result.reply, support.SUPPORT_WAITING_TEXT, 'suporte mais recente que a sessão Typebot deve manter a prioridade de sempre');
    results.suporteAtualMaisRecenteMantemPrioridade = 'ok';
  }

  // ── Inverso 2: awaiting_patient_decision continua absoluto ─────────────
  {
    const phone = '5511985480011';
    atendimentos = [{
      id: 'atd-aguardando-decisao',
      status: 'waiting',
      paciente_telefone: phone,
      condicao: 'suporte_whatsapp',
      dados_clinicos: {
        queue_type: 'support',
        whatsapp_support: true,
        support_sub_status: 'awaiting_patient_decision'
      }
    }];
    // Mesmo com uma sessão Typebot "ativa" e mais recente presente (não
    // deveria coexistir na prática, já que finalizeSupportAttendance limpa a
    // sessão — testado aqui como cinturão-e-suspensório).
    sessionsByPhone.set(phone, buildActiveTypebotSession({ typebotSessionStartedAt: '2026-08-19T08:53:38.544Z' }));

    const result = await support.resolveMetaInboundRouting({
      phone,
      text: '1',
      session: sessionsByPhone.get(phone)
    });

    assert.equal(result.handled, true);
    assert.equal(result.action, 'reply');
    assert.equal(result.reply, 'Atendimento encerrado. Obrigado pelo contato com o Doctor Prescreve! Até logo.');
    results.awaitingPatientDecisionContinuaAbsoluto = 'ok';
  }

  // ── Inverso 3: comandos explícitos de suporte continuam pertencendo ao
  // suporte, mesmo com sessão Typebot mais recente que o ticket ───────────
  {
    const phone = '5511985480012';

    atendimentos = [buildOldSupportTicket(phone)];
    sessionsByPhone.set(phone, buildActiveTypebotSession({ typebotSessionStartedAt: '2026-08-19T08:53:38.544Z' }));
    const encerrar = await support.resolveMetaInboundRouting({ phone, text: 'ENCERRAR', session: sessionsByPhone.get(phone) });
    assert.equal(encerrar.handled, true);
    assert.equal(encerrar.action, 'reply');
    assert.equal(encerrar.reply, support.SUPPORT_CLOSED_TEXT, '"ENCERRAR" deve fechar o suporte, não ir para o Typebot');
    results.comandoEncerrarPermaneceNoSuporte = 'ok';

    atendimentos = [buildOldSupportTicket(phone)];
    sessionsByPhone.set(phone, buildActiveTypebotSession({ typebotSessionStartedAt: '2026-08-19T08:53:38.544Z' }));
    const chatbot = await support.resolveMetaInboundRouting({ phone, text: '3', session: sessionsByPhone.get(phone) });
    assert.equal(chatbot.handled, true);
    assert.equal(chatbot.action, 'typebot_clean', '"3" deve fechar o suporte e reiniciar via typebot_clean, comportamento já existente');
    results.comando3PermaneceComoAtalhoDeSuporte = 'ok';

    atendimentos = [buildOldSupportTicket(phone)];
    sessionsByPhone.set(phone, buildActiveTypebotSession({ typebotSessionStartedAt: '2026-08-19T08:53:38.544Z' }));
    const aguardar = await support.resolveMetaInboundRouting({ phone, text: '1', session: sessionsByPhone.get(phone) });
    assert.equal(aguardar.handled, true);
    assert.equal(aguardar.action, 'reply');
    assert.equal(aguardar.reply, support.SUPPORT_WAITING_TEXT, '"1"/AGUARDAR deve permanecer no suporte, nunca ser tratado como fluxo Typebot');
    results.comando1AguardarPermaneceNoSuporte = 'ok';
  }

  // ── Inverso 4: sessões antigas sem typebot_session_started_at mantêm
  // comportamento conservador (ticket sempre vence) ───────────────────────
  {
    const phone = '5511985480013';
    atendimentos = [buildOldSupportTicket(phone)];
    // Sessão ativa "de verdade" (typebot_session_id + expected_input_id),
    // mas SEM o novo marcador — simula qualquer sessão em voo no momento do
    // deploy desta correção, criada antes dela existir.
    sessionsByPhone.set(phone, buildActiveTypebotSession({}));
    assert.equal(sessionsByPhone.get(phone).metadata.typebot_session_started_at, undefined);

    const result = await support.resolveMetaInboundRouting({
      phone,
      text: 'Vamos começar',
      session: sessionsByPhone.get(phone)
    });

    assert.equal(result.handled, true);
    assert.equal(result.action, 'reply');
    assert.equal(result.reply, support.SUPPORT_WAITING_TEXT, 'sem o marcador novo, o ticket deve continuar interceptando (comportamento anterior preservado)');
    results.semMarcadorNovoMantemComportamentoConservador = 'ok';
  }

  // ── Inverso 5: awaiting_menu_choice (7a94d2b) continua acima de tudo ────
  {
    const phone = '5511985480014';
    atendimentos = [buildOldSupportTicket(phone)];
    sessionsByPhone.set(phone, {
      id: 'sess-menu',
      typebot_session_id: null,
      metadata: { whatsapp_menu_state: support.MENU_STATE_AWAITING_CHOICE }
    });
    const ticketsBefore = createdSupportTickets;

    const result = await support.resolveMetaInboundRouting({ phone, text: '1', session: sessionsByPhone.get(phone) });

    assert.equal(result.action, 'typebot_clean', 'awaiting_menu_choice deve continuar acima de qualquer ticket de suporte, corrigido/residual ou não');
    assert.equal(createdSupportTickets, ticketsBefore);
    results.awaitingMenuChoiceContinuaAcimaDeTudo = 'ok';
  }

  // ── Regressão: sem ticket nenhum, sessão Typebot ativa continua indo para
  // o Typebot normalmente (mesmo comportamento de antes desta correção) ───
  {
    const phone = '5511985480015';
    atendimentos = [];
    sessionsByPhone.set(phone, buildActiveTypebotSession({ typebotSessionStartedAt: '2026-08-19T08:53:38.544Z' }));

    const result = await support.resolveMetaInboundRouting({ phone, text: 'Vamos começar', session: sessionsByPhone.get(phone) });

    assert.equal(result.handled, false);
    assert.equal(result.action, 'typebot');
    results.semTicketSessaoTypebotContinuaFuncionandoNormalmente = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error('FALHOU:', e.message, '\n', e.stack); process.exit(1); });
