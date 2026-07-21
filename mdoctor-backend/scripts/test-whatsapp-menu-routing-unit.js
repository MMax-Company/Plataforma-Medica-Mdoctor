// Teste isolado (sem rede, sem banco) de resolveMetaInboundRouting: injeta
// stubs no require.cache das dependências de banco/serviço ANTES de
// carregar whatsapp-support.service.js, para exercitar a função real
// (não um mock dela) com cenários de menu/roteamento da Fase 2 pedido 1.
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
stub(resolveFrom('../store/whatsapp-sessions.store'), {
  getActiveSurveySession: () => null,
  getSessionByPhone: async () => null
});

const supportServicePath = require.resolve(base);
delete require.cache[supportServicePath];
const support = require(base);
// listAtendimentos() stubado retorna [] sempre -> getPatientSupportContext e
// findOpenSupportByPhone (chamadas internas, não via module.exports) caem
// naturalmente em "nenhum suporte aberto" em todos os cenários abaixo.

async function main() {
  const results = {};

  // 1) Sem sessão nem suporte, mensagem nova ("Oi") recebe o menu oficial.
  const r1 = await support.resolveMetaInboundRouting({ phone: '5511999990001', text: 'Oi', session: { typebot_session_id: null, metadata: {} } });
  assert.equal(r1.action, 'reply');
  assert.equal(r1.reply, support.MENU_TEXT);
  assert(support.MENU_TEXT.includes('1 - Iniciar atendimento') && support.MENU_TEXT.includes('2 - Suporte'));
  results.menuSemSessao = 'ok';

  // 2) Opção "1" inicia o Typebot (typebot_clean) e NÃO retorna reply do menu.
  const r2 = await support.resolveMetaInboundRouting({ phone: '5511999990001', text: '1', session: { typebot_session_id: null, metadata: {} } });
  assert.equal(r2.action, 'typebot_clean');
  assert.equal(r2.reply, undefined);
  results.opcao1IniciaTypebot = 'ok';

  // 3) Opção "2" NÃO inicia Typebot — retorna reply de suporte.
  const r3 = await support.resolveMetaInboundRouting({ phone: '5511999990001', text: '2', session: { typebot_session_id: null, metadata: {} } });
  assert.equal(r3.action, 'reply');
  assert.notEqual(r3.action, 'typebot_clean');
  assert.equal(r3.reply, support.SUPPORT_WAITING_TEXT);
  results.opcao2NaoIniciaTypebot = 'ok';

  // 4) Durante triagem (sessão clínica ativa), 1/2/3 vão para o Typebot —
  //    e o menu NÃO aparece.
  const activeSession = { typebot_session_id: 'sess-abc', metadata: { typebot_expected_input_id: 'blk_algum_input' } };
  for (const text of ['1', '2', '3']) {
    const r = await support.resolveMetaInboundRouting({ phone: '5511999990001', text, session: activeSession });
    assert.equal(r.handled, false, `texto "${text}" durante triagem deveria ir ao Typebot (handled:false)`);
    assert.equal(r.action, 'typebot');
  }
  results.duranteTriagemVaiAoTypebot = 'ok';

  // 5) Texto qualquer sem sessão/suporte volta a mostrar o menu (não reinicia
  //    nada, só reapresenta a instrução).
  const r5 = await support.resolveMetaInboundRouting({ phone: '5511999990001', text: 'blablabla', session: { typebot_session_id: null, metadata: {} } });
  assert.equal(r5.action, 'reply');
  assert.equal(r5.reply, support.MENU_TEXT);
  results.textoInvalidoReapresentaMenu = 'ok';

  // 6) convertTypebotResponse nunca emite "Escolha uma opção:" mais de uma
  //    vez para a mesma pergunta, mesmo em uma única chamada.
  const { convertTypebotResponse } = require(path.join(__dirname, '..', 'src', 'services', 'typebot-whatsapp.bridge.js'));
  const choiceResponse = {
    messages: [{ type: 'text', content: { plainText: 'Você faz tratamento para:' } }],
    input: { type: 'choice input', items: [{ content: 'Hipertensão' }, { content: 'Diabetes' }] }
  };
  const converted = convertTypebotResponse(choiceResponse);
  const choicePrompts = converted.filter((o) => o.kind === 'buttons' || o.kind === 'list');
  assert.equal(choicePrompts.length, 1, 'só pode haver um bloco de escolha por resposta do Typebot');
  assert.equal(choicePrompts[0].body, 'Escolha uma opção:');
  results.escolhaUmaOpcaoUmaUnicaVez = 'ok';

  // 7) Sessão travada num expected_input antigo (ex.: upload de receita
  //    abandonado) não pode sequestrar uma nova conversa: "Oi"/"Olá" sempre
  //    volta ao menu oficial, mesmo com typebot_session_id/expected_input_id
  //    presentes. Regressão do bug observado em 2026-07-21 ("Invalid message.
  //    Please, try again." + botão "Conferir novamente" ao enviar "Oi").
  const staleUploadSession = {
    typebot_session_id: 'sess-stale-upload',
    metadata: { typebot_expected_input_id: 'blk_upload_check' }
  };
  for (const text of ['Oi', 'oi', 'Olá', 'OLA']) {
    const r = await support.resolveMetaInboundRouting({ phone: '5511999990001', text, session: staleUploadSession });
    assert.equal(r.handled, true, `"${text}" com sessão travada em blk_upload_check deveria ser tratado pelo menu (handled:true)`);
    assert.equal(r.action, 'reply', `"${text}" deveria retornar o menu, não seguir para o Typebot`);
    assert.equal(r.reply, support.MENU_TEXT);
  }
  // Confirma que a sessão travada continua indo ao Typebot para qualquer
  // outro texto (a correção é só para o gatilho de saudação, não remove a
  // continuidade legítima do fluxo).
  const rNonGreeting = await support.resolveMetaInboundRouting({ phone: '5511999990001', text: 'Já enviei', session: staleUploadSession });
  assert.equal(rNonGreeting.handled, false);
  assert.equal(rNonGreeting.action, 'typebot');
  results.saudacaoSempreRompeSessaoTravada = 'ok';

  console.log(JSON.stringify(results));
}

main().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
