// Teste isolado (sem rede, sem banco) para os dois ajustes pedidos em
// 09/08/2026, depois da auditoria do fluxo real do WhatsApp:
//
// 1) Estado explícito "aguardando escolha do menu inicial"
//    (whatsapp_menu_state = 'awaiting_menu_choice'): reproduz o incidente
//    real (sessão Typebot presa na pergunta de e-mail + "oi" + "1") e
//    confirma que "1"/"2" só assumem o significado de menu quando esse
//    estado está ativo, sem virar regra global para os números — fora
//    desse estado, uma sessão clínica ativa continua dona de "1"/"2"/"3".
//
// 2) Atalho "3 = falar com o suporte" da mensagem de entrega da receita
//    (post_delivery_support_available), funcionando independente da
//    pesquisa opcional pós-atendimento estar habilitada.
const assert = require('assert');
const path = require('path');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const base = path.join(__dirname, '..', 'src', 'services', 'whatsapp-support.service.js');
const resolveFrom = (p) => path.join(path.dirname(base), p);

stub(resolveFrom('../store/atendimentos.store'), {
  STATUS: { WAITING: 'waiting', EM_ATENDIMENTO: 'em_atendimento' },
  createAtendimento: async (row) => ({ id: 'atd-mock', ...row }),
  listAtendimentos: async () => [],
  getAtendimento: async () => null,
  updateAtendimentoStatus: async () => ({})
});
stub(resolveFrom('../store/audit.store'), { createAuditLog: async () => {} });
stub(resolveFrom('./clinical-persistence.service'), { recordSupportTicket: async () => {} });
stub(resolveFrom('./post-delivery-survey.service'), { handleSurveyInbound: async () => ({ handled: false }) });

// Sessões em memória, com o MESMO contrato do store real
// (whatsapp-sessions.store.js): getSessionByPhone lê, upsertSessionMetadata
// faz merge raso no metadata existente — permite testar a persistência
// real do estado entre uma chamada e outra, como o backend faz de fato.
const sessionsByPhone = new Map();
stub(resolveFrom('../store/whatsapp-sessions.store'), {
  getActiveSurveySession: () => null,
  getSessionByPhone: async (phone) => sessionsByPhone.get(phone) || null,
  upsertSessionMetadata: async ({ phone, metadataPatch = {} }) => {
    const existing = sessionsByPhone.get(phone) || { id: `sess-${phone}`, typebot_session_id: null, metadata: {} };
    const merged = { ...existing, metadata: { ...(existing.metadata || {}), ...metadataPatch } };
    sessionsByPhone.set(phone, merged);
    return merged;
  }
});

const supportServicePath = require.resolve(base);
delete require.cache[supportServicePath];
const support = require(base);

async function main() {
  const results = {};

  // ── Caso 1: reset de sessão antiga via estado de menu ──────────────────

  // Reproduz o incidente real: sessão Typebot presa na pergunta de e-mail.
  const phone1 = '5511985480001';
  sessionsByPhone.set(phone1, {
    id: 'sess-phone1',
    typebot_session_id: 'n16ytche2txa5relkoz87lh1',
    metadata: { typebot_expected_input_id: 'dwoaqosurlamebpra9yf7pm4' }
  });

  // "oi" reapresenta o menu e grava o estado de espera.
  const greet = await support.resolveMetaInboundRouting({
    phone: phone1,
    text: 'oi',
    session: sessionsByPhone.get(phone1)
  });
  assert.equal(greet.action, 'reply');
  assert.equal(greet.reply, support.MENU_TEXT);
  assert.equal(
    sessionsByPhone.get(phone1).metadata.whatsapp_menu_state,
    support.MENU_STATE_AWAITING_CHOICE,
    'saudação deve gravar o estado de menu na sessão'
  );
  results.saudacaoGravaEstadoDeMenu = 'ok';

  // "1" agora reinicia o Typebot do zero (typebot_clean), mesmo com a sessão
  // antiga ainda presa em "e-mail" — este é o bug real relatado.
  const start = await support.resolveMetaInboundRouting({
    phone: phone1,
    text: '1',
    session: sessionsByPhone.get(phone1)
  });
  assert.equal(start.action, 'typebot_clean', '"1" com estado de menu ativo deve reiniciar o Typebot, não cair na pergunta de e-mail antiga');
  assert.equal(
    sessionsByPhone.get(phone1).metadata.whatsapp_menu_state,
    null,
    'estado de menu deve ser limpo depois da escolha'
  );
  results.opcao1ReiniciaSessaoAntigaPresaEmEmail = 'ok';

  // ── Caso 1b: opção "2" com estado de menu ativo vai para suporte e limpa o estado ──
  const phone2 = '5511985480002';
  sessionsByPhone.set(phone2, { id: 'sess-phone2', typebot_session_id: null, metadata: { whatsapp_menu_state: support.MENU_STATE_AWAITING_CHOICE } });
  const opt2 = await support.resolveMetaInboundRouting({ phone: phone2, text: '2', session: sessionsByPhone.get(phone2) });
  assert.equal(opt2.action, 'reply');
  assert.equal(opt2.reply, support.SUPPORT_WAITING_TEXT);
  assert.equal(sessionsByPhone.get(phone2).metadata.whatsapp_menu_state, null, 'estado de menu deve ser limpo após ir para suporte');
  results.opcao2ComEstadoDeMenuVaiParaSuporteELimpaEstado = 'ok';

  // ── Caso 1c: escolha inválida mantém o estado de menu ativo ─────────────
  const phone3 = '5511985480003';
  sessionsByPhone.set(phone3, { id: 'sess-phone3', typebot_session_id: null, metadata: { whatsapp_menu_state: support.MENU_STATE_AWAITING_CHOICE } });
  const invalid = await support.resolveMetaInboundRouting({ phone: phone3, text: 'blablabla', session: sessionsByPhone.get(phone3) });
  assert.equal(invalid.action, 'reply');
  assert.equal(invalid.reply, support.MENU_TEXT);
  assert.equal(
    sessionsByPhone.get(phone3).metadata.whatsapp_menu_state,
    support.MENU_STATE_AWAITING_CHOICE,
    'escolha inválida não deve limpar o estado de menu'
  );
  results.escolhaInvalidaMantemEstadoDeMenu = 'ok';

  // ── Caso 1d: NÃO é uma regra global — sem o estado de menu, sessão clínica
  // ativa continua dona de "1"/"2"/"3" (ex.: "Quantos medicamentos?" no
  // Typebot usa botões 1/2/3 como resposta clínica real). ─────────────────
  const phone4 = '5511985480004';
  const activeClinicalSession = {
    id: 'sess-phone4',
    typebot_session_id: 'sess-abc',
    metadata: { typebot_expected_input_id: 'w97ho902ina4lg7b6dn0sycw' } // "Quantos medicamentos?"
  };
  sessionsByPhone.set(phone4, activeClinicalSession);
  for (const text of ['1', '2', '3']) {
    const r = await support.resolveMetaInboundRouting({ phone: phone4, text, session: sessionsByPhone.get(phone4) });
    assert.equal(r.handled, false, `"${text}" durante sessão clínica ativa (sem estado de menu) deve ir ao Typebot`);
    assert.equal(r.action, 'typebot');
  }
  results.semEstadoDeMenuSessaoClinicaContinuaDonaDosNumeros = 'ok';

  // ── Caso 2: atalho "3 = suporte" pós-entrega, independente da pesquisa ──

  const phone5 = '5511985480005';
  sessionsByPhone.set(phone5, {
    id: 'sess-phone5',
    typebot_session_id: null,
    metadata: { post_delivery_support_available: true }
  });
  const supportShortcut = await support.resolveMetaInboundRouting({ phone: phone5, text: '3', session: sessionsByPhone.get(phone5) });
  assert.equal(supportShortcut.action, 'reply');
  assert.equal(supportShortcut.reply, support.SUPPORT_WAITING_TEXT, '"3" pós-entrega deve abrir o suporte, mesmo com a pesquisa desativada (handleSurveyInbound stubado como not handled)');
  results.atalho3PosEntregaVaiParaSuporte = 'ok';

  // Sem o marcador de entrega, "3" não tem efeito especial — só cai no
  // comportamento padrão (reapresenta o menu, sem sessão/suporte ativos).
  const phone6 = '5511985480006';
  sessionsByPhone.set(phone6, { id: 'sess-phone6', typebot_session_id: null, metadata: {} });
  const noShortcut = await support.resolveMetaInboundRouting({ phone: phone6, text: '3', session: sessionsByPhone.get(phone6) });
  assert.equal(noShortcut.action, 'reply');
  assert.equal(noShortcut.reply, support.MENU_TEXT, 'sem o marcador de entrega, "3" não deve abrir suporte');
  results.semMarcadorDeEntrega3NaoAbreSuporte = 'ok';

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
