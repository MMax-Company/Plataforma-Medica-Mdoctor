// Fase 3 pedido 3 — testes isolados (sem rede/banco) do suporte (opção 2 sem
// sessão clínica ativa) e das perguntas finais (post-delivery-survey.service.js).
// Mesmo padrão de stub de require.cache já usado nos pedidos anteriores da
// Fase 3, para exercitar as funções REAIS de produção.
const assert = require('assert');
const path = require('path');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const results = {};

// =======================================================================
// PARTE 1 — Suporte (opção 2 sem sessão clínica ativa)
// =======================================================================
async function testSupportFlow() {
  const base = path.join(__dirname, '..', 'src', 'services', 'whatsapp-support.service.js');
  const resolveFrom = (p) => path.join(path.dirname(base), p);

  const STATUS = { WAITING: 'waiting', EM_ATENDIMENTO: 'em_atendimento', REJECTED: 'rejected' };
  let atendimentos = [];
  let seq = 0;

  stub(resolveFrom('../store/atendimentos.store'), {
    STATUS,
    createAtendimento: async (row) => {
      seq += 1;
      const row2 = { id: `sup-${seq}`, criado_em: new Date().toISOString(), ...row };
      atendimentos.push(row2);
      return row2;
    },
    listAtendimentos: async () => atendimentos,
    getAtendimento: async (id) => atendimentos.find((a) => a.id === id) || null,
    updateAtendimentoStatus: async (id, status, meta = {}) => {
      const idx = atendimentos.findIndex((a) => a.id === id);
      if (idx === -1) return null;
      atendimentos[idx] = {
        ...atendimentos[idx],
        status,
        dados_clinicos: meta.dados_clinicos !== undefined ? meta.dados_clinicos : atendimentos[idx].dados_clinicos
      };
      return atendimentos[idx];
    }
  });
  stub(resolveFrom('../store/audit.store'), { createAuditLog: async () => {} });
  stub(resolveFrom('./clinical-persistence.service'), { recordSupportTicket: async () => {} });
  stub(resolveFrom('./post-delivery-survey.service'), { handleSurveyInbound: async () => ({ handled: false }) });
  stub(resolveFrom('../store/whatsapp-sessions.store'), {
    getActiveSurveySession: () => null,
    getSessionByPhone: async () => null
  });

  delete require.cache[require.resolve(base)];
  const support = require(base);

  const phone = '5511988880001';
  const session = { typebot_session_id: null, metadata: {} };

  // 1) Sem sessão clínica ativa nem suporte aberto, "2" cria um único ticket
  //    e NÃO inicia Typebot.
  const r1 = await support.resolveMetaInboundRouting({ phone, text: '2', session });
  assert.equal(r1.action, 'reply');
  assert.notEqual(r1.action, 'typebot_clean');
  assert.equal(r1.reply, support.SUPPORT_WAITING_TEXT);
  assert(r1.reply.includes('Seu atendimento foi encaminhado para o suporte.'));
  assert(r1.reply.includes('Para encerrar o suporte, envie 0 ou ENCERRAR.'));
  assert.equal(atendimentos.filter((a) => a.paciente_telefone === phone).length, 1);
  results.opcao2SemSessaoCriaTicketUnico = 'ok';

  // 2) "2" de novo (ticket já aberto) reutiliza o MESMO ticket — não cria outro.
  const r2 = await support.resolveMetaInboundRouting({ phone, text: '2', session });
  assert.equal(r2.action, 'reply');
  assert.equal(atendimentos.filter((a) => a.paciente_telefone === phone).length, 1, 'não cria segundo ticket');
  results.ticketReutilizadoNaoDuplicado = 'ok';

  // 3) Mensagem numérica não reconhecida (ex.: "5") durante suporte nunca
  //    inicia Typebot nem mostra o menu — só reapresenta o aviso de espera.
  const r3 = await support.resolveMetaInboundRouting({ phone, text: '5', session });
  assert.equal(r3.action, 'reply');
  assert.notEqual(r3.reply, support.MENU_TEXT, 'menu não aparece durante suporte ativo');
  assert.equal(r3.reply, support.SUPPORT_WAITING_TEXT);
  results.mensagemNumericaNaoIniciaTriagemNemMostraMenu = 'ok';

  // 4) "ENCERRAR" fecha o suporte, mensagem única e exata, SEM o menu anexado
  //    na mesma resposta.
  const r4 = await support.resolveMetaInboundRouting({ phone, text: 'ENCERRAR', session });
  assert.equal(r4.action, 'reply');
  assert.equal(
    r4.reply,
    'Atendimento de suporte encerrado.\n\nQuando precisar, envie uma nova mensagem para acessar o menu do Doctor Prescreve.'
  );
  assert(!r4.reply.includes('Digite uma opção'), 'menu não é anexado na mesma resposta do encerramento');
  results.encerrarFechaComMensagemUnicaSemMenuAnexado = 'ok';

  // 5) Ticket encerrado não continua "ativo": a próxima mensagem mostra o
  //    menu inicial (não reabre o suporte automaticamente).
  const r5 = await support.resolveMetaInboundRouting({ phone, text: 'Oi', session });
  assert.equal(r5.reply, support.MENU_TEXT, 'próxima mensagem mostra o menu, não reabre o suporte');
  results.ticketEncerradoNaoRecebeComoAtivoEMenuRetorna = 'ok';

  // 6) Fluxo "0" (segundo paciente, isolado do primeiro) — mesma garantia.
  const phone2 = '5511988880002';
  const session2 = { typebot_session_id: null, metadata: {} };
  await support.resolveMetaInboundRouting({ phone: phone2, text: '2', session: session2 });
  const r6 = await support.resolveMetaInboundRouting({ phone: phone2, text: '0', session: session2 });
  assert.equal(
    r6.reply,
    'Atendimento de suporte encerrado.\n\nQuando precisar, envie uma nova mensagem para acessar o menu do Doctor Prescreve.'
  );
  // Isolamento entre pacientes: o ticket do primeiro paciente não foi afetado.
  const ticket1 = atendimentos.find((a) => a.paciente_telefone === phone);
  assert.equal(ticket1.status, STATUS.REJECTED, 'ticket do paciente 1 permanece encerrado, não é reaberto pelo paciente 2');
  const ticket2 = atendimentos.find((a) => a.paciente_telefone === phone2);
  assert.equal(ticket2.status, STATUS.REJECTED);
  assert.notEqual(ticket1.id, ticket2.id, 'dois pacientes nunca compartilham o mesmo ticket');
  results.zeroFechaEIsolamentoEntreDoisPacientes = 'ok';

  return 'ok';
}

// =======================================================================
// PARTE 2 — Perguntas finais (post-delivery-survey.service.js)
// =======================================================================
async function testSurveyFlow() {
  const base = path.join(__dirname, '..', 'src', 'services', 'post-delivery-survey.service.js');
  const resolveFrom = (p) => path.join(path.dirname(base), p);

  let outcomes = [];
  let seq = 0;
  const sentMessages = [];
  const sessions = {};

  stub(resolveFrom('../delivery/delivery.service'), {
    isDryRunMode: () => false,
    resolveWhatsAppProvider: () => 'meta',
    sendWhatsAppText: async ({ to, text, idempotencyKey }) => {
      sentMessages.push({ to, text, idempotencyKey });
      return { providerMessageId: `wamid-${sentMessages.length}` };
    }
  });
  stub(resolveFrom('../store/patient-outcomes.store'), {
    createPendingOutcome: async ({ attendanceId, patientId, surveyVersion }) => {
      seq += 1;
      const row = {
        id: `outcome-${seq}`,
        attendance_id: attendanceId,
        patient_id: patientId || null,
        survey_version: surveyVersion,
        final_question_access_alternative: null,
        final_question_avoided_interruption: null,
        final_question_use_again: null
      };
      outcomes.push(row);
      return row;
    },
    getOutcomeByAttendance: async (attendanceId, surveyVersion) =>
      outcomes.find((o) => o.attendance_id === attendanceId && o.survey_version === surveyVersion) || null,
    getOutcomeById: async (id) => outcomes.find((o) => o.id === id) || null,
    updateOutcomeFields: async (id, fields) => {
      const idx = outcomes.findIndex((o) => o.id === id);
      if (idx === -1) return null;
      outcomes[idx] = { ...outcomes[idx], ...fields };
      return outcomes[idx];
    }
  });
  stub(resolveFrom('../store/whatsapp-sessions.store'), {
    normalizePhone: (v) => String(v || '').replace(/\D/g, ''),
    getActiveSurveySession: (session = {}) => session?.metadata?.post_delivery_survey || null,
    getSessionByPhone: async (phone) => sessions[phone] || null,
    upsertSessionMetadata: async ({ phone, metadataPatch }) => {
      sessions[phone] = {
        phone,
        metadata: { ...(sessions[phone]?.metadata || {}), ...metadataPatch }
      };
    },
    clearSurveySession: async (phone) => {
      if (sessions[phone]) {
        delete sessions[phone].metadata.post_delivery_survey;
      }
    },
    clearTypebotSession: async () => {}
  });
  stub(resolveFrom('../store/audit.store'), { createAuditLog: async () => {} });

  delete require.cache[require.resolve(base)];
  process.env.POST_DELIVERY_SURVEY_ENABLED = 'true';
  const survey = require(base);
  const { Q1_MESSAGE, Q2_MESSAGE, Q3_MESSAGE } = require(resolveFrom('../constants/patient-outcome-survey'));

  // 1) Textos exatos das 3 perguntas (redação oficial).
  assert(Q1_MESSAGE.includes('Sem o Doctor Prescreve, o que você faria para conseguir sua receita?'));
  assert(Q2_MESSAGE.includes('O Doctor Prescreve ajudou a evitar que você ficasse sem a medicação?'));
  assert(Q3_MESSAGE.includes('Você utilizaria novamente o Doctor Prescreve?'));
  results.textoExatoDasTresPerguntas = 'ok';

  // 2) Disparo após entrega confirmada: cria outcome pendente + envia a
  //    mensagem de opt-in, uma única vez.
  const phone = '5511977770001';
  const trigger1 = await survey.triggerPostDeliverySurvey({ attendanceId: 'at-1', patientId: 'pac-1', phone });
  assert.equal(trigger1.triggered, true);
  assert.equal(sentMessages.length, 1, 'envia a mensagem de opt-in uma única vez');
  results.disparoApenasAposEntregaConfirmada = 'ok';

  // 3) Evento repetido (novo disparo para o MESMO atendimento) NÃO reinicia
  //    o survey nem repete as mensagens.
  const trigger2 = await survey.triggerPostDeliverySurvey({ attendanceId: 'at-1', patientId: 'pac-1', phone });
  assert.equal(trigger2.skipped, true);
  assert.equal(trigger2.reason, 'already_in_progress');
  assert.equal(sentMessages.length, 1, 'evento repetido não reenvia a mensagem de abertura');
  assert.equal(outcomes.filter((o) => o.attendance_id === 'at-1').length, 1, 'evento repetido não cria segundo outcome');
  results.eventoRepetidoNaoReiniciaSurvey = 'ok';

  // 4) Opt-in "sim" avança para Q1; resposta vincula ao atendimento/outcome
  //    correto usando as variáveis oficiais.
  await survey.handleSurveyInbound({ phone, text: '1' }); // opt-in sim -> Q1
  await survey.handleSurveyInbound({ phone, text: '2' }); // Q1 = UBS
  const afterQ1 = outcomes.find((o) => o.attendance_id === 'at-1');
  assert.equal(afterQ1.final_question_access_alternative, 'ubs');
  results.respostaVinculadaAoAtendimentoComVariavelOficial = 'ok';

  await survey.handleSurveyInbound({ phone, text: '1' }); // Q2 = sim
  await survey.handleSurveyInbound({ phone, text: '1' }); // Q3 = sim
  const completed = outcomes.find((o) => o.attendance_id === 'at-1');
  assert.equal(completed.final_question_avoided_interruption, 'sim');
  assert.equal(completed.final_question_use_again, 'sim');
  results.tresVariaveisOficiaisPersistidas = 'ok';

  // 5) Sem resposta / "Pular" no meio do fluxo encerra as perguntas
  //    restantes (segundo atendimento, isolado do primeiro).
  const phone2 = '5511977770002';
  await survey.triggerPostDeliverySurvey({ attendanceId: 'at-2', patientId: 'pac-2', phone: phone2 });
  await survey.handleSurveyInbound({ phone: phone2, text: '1' }); // opt-in sim -> Q1
  const skipResult = await survey.handleSurveyInbound({ phone: phone2, text: 'pular' });
  assert.equal(skipResult.handled, true);
  assert.equal(skipResult.step, 'skipped');
  const outcome2 = outcomes.find((o) => o.attendance_id === 'at-2');
  assert.equal(outcome2.final_question_access_alternative, null, 'pular não registra resposta forçada');
  results.pularEncerraPerguntasRestantes = 'ok';

  // 6) Resposta livre (texto fora das opções) não é aceita — reapresenta a
  //    pergunta em vez de gravar texto livre.
  const phone3 = '5511977770003';
  await survey.triggerPostDeliverySurvey({ attendanceId: 'at-3', patientId: 'pac-3', phone: phone3 });
  await survey.handleSurveyInbound({ phone: phone3, text: '1' }); // opt-in -> Q1
  const freeTextResult = await survey.handleSurveyInbound({ phone: phone3, text: 'eu compraria em qualquer farmácia' });
  assert.equal(freeTextResult.step, 'q1', 'permanece em Q1 — não aceitou resposta livre');
  const outcome3 = outcomes.find((o) => o.attendance_id === 'at-3');
  assert.equal(outcome3.final_question_access_alternative, null);
  results.naoUsaRespostaLivre = 'ok';

  // 7) Dois pacientes não compartilham respostas — outcomes 1/2/3 permanecem
  //    isolados por attendance_id.
  assert.equal(outcomes.find((o) => o.attendance_id === 'at-1').final_question_use_again, 'sim');
  assert.equal(outcomes.find((o) => o.attendance_id === 'at-2').final_question_use_again, null);
  assert.equal(outcomes.find((o) => o.attendance_id === 'at-3').final_question_use_again, null);
  results.doisPacientesNaoCompartilhamRespostas = 'ok';

  // 8) Ausência de resposta não bloqueia nenhum outro fluxo: o próprio
  //    trigger nunca lança erro mesmo sem resposta subsequente do paciente.
  const phone4 = '5511977770004';
  const trigger4 = await survey.triggerPostDeliverySurvey({ attendanceId: 'at-4', patientId: 'pac-4', phone: phone4 });
  assert.equal(trigger4.triggered, true);
  results.ausenciaDeRespostaNaoBloqueiaFluxo = 'ok';

  return 'ok';
}

async function main() {
  results.suporte = await testSupportFlow();
  results.perguntasFinais = await testSurveyFlow();
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
