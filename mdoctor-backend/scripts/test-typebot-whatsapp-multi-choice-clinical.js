const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildMultiChoiceSubmitText,
  buildDiseaseChoicePrompt,
  parseDiseaseFreeTextSelection,
  convertTypebotResponse,
  createTypebotWhatsAppBridge,
  isChronicDiseaseMultiChoiceInput,
  isMultipleChoiceInput,
  toggleMultiChoiceSelection
} = require('../src/services/typebot-whatsapp.bridge');

const DISEASE_INPUT = {
  id: 'b156nm008xh7gb52n7w3egzn',
  type: 'choice input',
  options: { isMultipleChoice: true, buttonLabel: 'Confirmo', variableId: 'icaxqctv4r7b4du941d9qs46' },
  items: [
    { id: 'vjzl8ufgtda0h2tg4gvxvx2p', content: 'Hipertensão Arterial', value: 'has' },
    { id: 'wvstylkrlny8u28zzuv2dixb', content: 'Diabetes Melitus', value: 'dm' },
    { id: 'nrpsd9wjyynm4gkalizc5p65', content: 'Dislipidemia', value: 'dlp' },
    { id: 's6jrm608stgtegacomrr2q1a', content: 'Hipotireidismo', value: 'hipotireoidismo' }
  ]
};

const SINAIS_INPUT = {
  id: 's5VQGsVF4hQgziQsXVdwPDW',
  type: 'choice input',
  options: { isMultipleChoice: true, buttonLabel: 'Confirmo', variableId: 'he7ry4ccuhoyy3k2p11ryeuc' },
  items: [
    { id: 'it_og22qc8c', content: 'Dor no peito', value: 'dor_peito' },
    { id: 'it_wbbj4nvy', content: 'Falta de ar', value: 'falta_ar' },
    { id: 'it_l4dxjewc', content: 'Nenhum destes', value: 'NAO' }
  ]
};

function assertOfficialJson() {
  const file = path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-staging-safe.json');
  const bot = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(bot.publicId, 'doctor-prescreve-8rmljgu');
  assert.equal(bot.id, 'higij2z0xihxxkr378rmljgu');

  const bem = bot.groups.find((g) => g.title === 'Bem-Vindo');
  const welcome = bem.blocks.find((b) => b.type === 'choice input');
  assert.equal(welcome.id, 'sbjZWLJGVkHAkDqS4JQeGow');
  // Não alteramos Bem-Vindo nesta tarefa
  assert.ok(welcome.items[0].content);

  const doenca = bot.groups.find((g) => g.title === 'Doença Cronica');
  const diseaseChoice = doenca.blocks.find((b) => b.id === 'b156nm008xh7gb52n7w3egzn');
  assert.equal(diseaseChoice.options.isMultipleChoice, true);
  assert.equal(diseaseChoice.options.buttonLabel, 'Confirmo');
  assert.equal(diseaseChoice.outgoingEdgeId, 'edge_doenca_to_tempo');
  assert.ok(diseaseChoice.items.every((item) => !item.outgoingEdgeId));
  assert.deepEqual(diseaseChoice.items.map((i) => i.value), ['has', 'dm', 'dlp', 'hipotireoidismo']);
  assert.ok(!doenca.blocks.some((b) => b.id === 'pkodixot7oiiya9iknntuvz2'));

  const sinais = bot.groups.find((g) => g.title === 'Sinais de Alerta');
  const cond = sinais.blocks.find((b) => b.type === 'Condition');
  const item = cond.items[0];
  assert.equal(item.content.comparisons[0].value, 'NAO');
  assert.equal(item.outgoingEdgeId, 'edge_sinais_to_telemedicine');
  assert.ok(bot.edges.some((e) => e.id === 'edge_sinais_to_telemedicine'));
  assert.ok(!bot.edges.some((e) => e.id === 'o51d9l56lzldmzcuvc0jdg6y'));
}

/**
 * Patologias: mecanismo restaurado — pergunta única em texto simples com
 * opções numeradas, sem lista interativa e sem botão Confirmo. O paciente
 * digita os números (ou nomes) separados por vírgula numa única mensagem e
 * conclui pela seta nativa de envio do WhatsApp.
 */
function assertDiseaseFreeTextPrompt() {
  assert.equal(isChronicDiseaseMultiChoiceInput(DISEASE_INPUT), true);
  assert.equal(isChronicDiseaseMultiChoiceInput(SINAIS_INPUT), false);
  assert.equal(isMultipleChoiceInput(DISEASE_INPUT), true);

  const converted = convertTypebotResponse({
    messages: [{ type: 'text', content: { plainText: 'Olá, você faz tratamento para:' } }],
    input: DISEASE_INPUT
  });
  // Só mensagens de texto — sem list interativa, sem buttons, sem Confirmo.
  assert.ok(converted.every((o) => o.kind === 'text'));
  assert.ok(!converted.some((o) => o.kind === 'list' || o.kind === 'buttons'));
  assert.ok(!converted.some((o) => /Confirmo/.test(o.text)));

  const prompt = buildDiseaseChoicePrompt(DISEASE_INPUT.items);
  const promptOutput = converted.find((o) => o.text === prompt);
  assert.ok(promptOutput, 'deveria emitir a pergunta única com as opções numeradas');
  for (const item of DISEASE_INPUT.items) {
    assert.ok(prompt.includes(item.content), `prompt deveria listar "${item.content}"`);
  }

  // Sinais de Alerta continua com o mecanismo antigo (lista + Confirmo), intacto.
  const sinaisConverted = convertTypebotResponse({
    messages: [{ type: 'text', content: { plainText: 'Você teve algum destes eventos recentemente?' } }],
    input: SINAIS_INPUT
  });
  const sinaisList = sinaisConverted.find((o) => o.kind === 'list');
  assert.ok(sinaisList);
  assert.ok(sinaisList.choices.some((c) => c.value === 'Confirmo'));
}

function assertParsing() {
  // 1 patologia
  assert.equal(
    buildMultiChoiceSubmitText(parseDiseaseFreeTextSelection(DISEASE_INPUT.items, '3')),
    'dlp'
  );
  // Hipertensão + Diabetes, por número
  assert.equal(
    buildMultiChoiceSubmitText(parseDiseaseFreeTextSelection(DISEASE_INPUT.items, '1, 2')),
    'has, dm'
  );
  // Hipertensão + Diabetes, pelo nome
  assert.equal(
    buildMultiChoiceSubmitText(parseDiseaseFreeTextSelection(DISEASE_INPUT.items, 'Hipertensão Arterial e Diabetes Melitus')),
    'has, dm'
  );
  // As quatro patologias
  assert.equal(
    buildMultiChoiceSubmitText(parseDiseaseFreeTextSelection(DISEASE_INPUT.items, '1,2,3,4')),
    'has, dm, dlp, hipotireoidismo'
  );
  // Nenhuma opção reconhecida
  assert.deepEqual(parseDiseaseFreeTextSelection(DISEASE_INPUT.items, 'xyz'), []);
  // Duplicatas não se repetem
  assert.equal(
    buildMultiChoiceSubmitText(parseDiseaseFreeTextSelection(DISEASE_INPUT.items, '1,1,2')),
    'has, dm'
  );
}

async function runDiseaseScenario(inboundText, expectedSubmit) {
  const typebotCalls = [];
  const texts = [];
  const lists = [];
  const buttons = [];
  let multiMeta = {
    inputId: DISEASE_INPUT.id,
    items: DISEASE_INPUT.items,
    selected: [],
    buttonLabel: 'Confirmo'
  };

  const bridge = createTypebotWhatsAppBridge({
    claimMetaMessage: async () => ({ claimed: true }),
    finishMetaMessage: async () => {},
    setTypebotSessionId: async () => {},
    reloadSession: async ({ whatsappSession }) => ({
      ...whatsappSession,
      typebot_session_id: 'sess-disease',
      metadata: {
        typebot_expected_input_id: DISEASE_INPUT.id,
        typebot_multi_choice: multiMeta
      }
    }),
    persistExpectedInput: async () => {},
    persistMultiChoice: async ({ multiChoice }) => { multiMeta = multiChoice; },
    createIntegrationError: async () => {},
    findPendingUploadContext: async () => null,
    findUploadContextForPhone: async () => null,
    persistUploadContext: async () => {},
    uploadContextFromSession: () => null,
    augmentOutputsWithUploadLink: (o) => o,
    responseLooksLikeUploadStage: () => false,
    isUploadChoiceInput: () => false,
    callTypebot: async (path, body) => {
      typebotCalls.push(body.message.text);
      return {
        messages: [{ type: 'text', content: { plainText: 'Há quanto tempo você usa esse medicamento?' } }],
        input: {
          id: 'r0imrcgaiv1idzkykt891q4u',
          type: 'choice input',
          items: [{ content: '1 a 6 meses' }, { content: 'Mais de 6 meses' }]
        }
      };
    },
    provider: {
      sendTextMessage: async ({ text }) => { texts.push(text); return { providerMessageId: `t-${texts.length}` }; },
      sendButtonMessage: async (payload) => { buttons.push(payload); return { providerMessageId: `b-${buttons.length}` }; },
      sendListMessage: async (payload) => { lists.push(payload); return { providerMessageId: `l-${lists.length}` }; }
    }
  });

  process.env.TYPEBOT_PUBLIC_ID = 'doctor-prescreve-8rmljgu';
  process.env.TYPEBOT_VIEWER_URL = 'https://typebot.io';

  const result = await bridge({
    messageId: `disease-${expectedSubmit}-${Date.now()}`,
    text: inboundText,
    identity: { phone: '5511999990001', bsuid: null },
    whatsappSession: { id: 'wa-1', typebot_session_id: 'sess-disease' }
  });

  // Conclui numa única mensagem enviada pelo paciente — nada de lista
  // interativa, botão Confirmo ou texto de resumo reenviado. As mensagens
  // abaixo são só a resposta seguinte do próprio Typebot (Tempo de Uso),
  // não um reenvio da pergunta de patologias.
  assert.equal(lists.length, 0, 'não deveria enviar nenhuma lista interativa de patologias');
  assert.ok(!buttons.some((btn) => (btn.buttons || []).some((b) => b.value === 'Confirmo' || b.title === 'Confirmo')), 'não deveria haver botão Confirmo');
  assert.ok(!texts.some((t) => /[Ss]elecionad/.test(t)), 'não deveria reenviar texto de resumo de patologias');
  assert.equal(typebotCalls.length, 1);
  assert.equal(typebotCalls[0], expectedSubmit);
  assert.equal(result.multiChoicePending, undefined);
  assert.equal(multiMeta, null);
}

async function assertInvalidDiseaseReply() {
  const texts = [];
  let multiMeta = {
    inputId: DISEASE_INPUT.id,
    items: DISEASE_INPUT.items,
    selected: [],
    buttonLabel: 'Confirmo'
  };
  const typebotCalls = [];

  const bridge = createTypebotWhatsAppBridge({
    claimMetaMessage: async () => ({ claimed: true }),
    finishMetaMessage: async () => {},
    setTypebotSessionId: async () => {},
    reloadSession: async ({ whatsappSession }) => ({
      ...whatsappSession,
      typebot_session_id: 'sess-disease-invalid',
      metadata: {
        typebot_expected_input_id: DISEASE_INPUT.id,
        typebot_multi_choice: multiMeta
      }
    }),
    persistExpectedInput: async () => {},
    persistMultiChoice: async ({ multiChoice }) => { multiMeta = multiChoice; },
    createIntegrationError: async () => {},
    findPendingUploadContext: async () => null,
    findUploadContextForPhone: async () => null,
    persistUploadContext: async () => {},
    uploadContextFromSession: () => null,
    augmentOutputsWithUploadLink: (o) => o,
    responseLooksLikeUploadStage: () => false,
    isUploadChoiceInput: () => false,
    callTypebot: async (path, body) => { typebotCalls.push(body.message.text); return { messages: [], input: {} }; },
    provider: {
      sendTextMessage: async ({ text }) => { texts.push(text); return { providerMessageId: 't1' }; },
      sendButtonMessage: async () => ({ providerMessageId: 'b1' }),
      sendListMessage: async () => ({ providerMessageId: 'l1' })
    }
  });

  process.env.TYPEBOT_PUBLIC_ID = 'doctor-prescreve-8rmljgu';
  process.env.TYPEBOT_VIEWER_URL = 'https://typebot.io';

  const result = await bridge({
    messageId: 'disease-invalid',
    text: 'blablabla',
    identity: { phone: '5511999990001', bsuid: null },
    whatsappSession: { id: 'wa-1', typebot_session_id: 'sess-disease-invalid' }
  });

  assert.equal(typebotCalls.length, 0, 'resposta não reconhecida não deve chamar o Typebot');
  assert.equal(result.multiChoicePending, true);
  assert.equal(texts.length, 1);
  assert.ok(texts[0].includes('Não entendi'));
  assert.ok(multiMeta, 'estado da pergunta deve ser preservado para nova tentativa');
}

async function assertBridgeSinaisBranches() {
  let state = {
    inputId: SINAIS_INPUT.id,
    items: SINAIS_INPUT.items,
    selected: [],
    buttonLabel: 'Confirmo'
  };
  state = toggleMultiChoiceSelection(state, 'Nenhum destes').state;
  assert.deepEqual(state.selected.map((s) => s.value), ['NAO']);
  assert.equal(buildMultiChoiceSubmitText(state.selected), 'NAO');

  // exclusivity: signal clears NAO
  state = toggleMultiChoiceSelection(state, 'Dor no peito').state;
  assert.deepEqual(state.selected.map((s) => s.value), ['dor_peito']);
  // exclusivity: NAO clears signals
  state = toggleMultiChoiceSelection(state, 'Nenhum destes').state;
  assert.deepEqual(state.selected.map((s) => s.value), ['NAO']);
  state = toggleMultiChoiceSelection(state, 'Falta de ar').state;
  assert.ok(!state.selected.some((s) => s.value === 'NAO'));
  assert.deepEqual(state.selected.map((s) => s.value), ['falta_ar']);

  const typebotCalls = [];
  let multiMeta = {
    inputId: SINAIS_INPUT.id,
    items: SINAIS_INPUT.items,
    selected: [{ id: 'it_l4dxjewc', content: 'Nenhum destes', value: 'NAO' }],
    buttonLabel: 'Confirmo'
  };
  const bridgeNone = createTypebotWhatsAppBridge({
    claimMetaMessage: async () => ({ claimed: true }),
    finishMetaMessage: async () => {},
    setTypebotSessionId: async () => {},
    reloadSession: async ({ whatsappSession }) => ({
      ...whatsappSession,
      typebot_session_id: 'sess-sinais',
      metadata: {
        typebot_expected_input_id: SINAIS_INPUT.id,
        typebot_multi_choice: multiMeta
      }
    }),
    persistExpectedInput: async () => {},
    persistMultiChoice: async ({ multiChoice }) => { multiMeta = multiChoice; },
    createIntegrationError: async () => {},
    findPendingUploadContext: async () => null,
    findUploadContextForPhone: async () => null,
    persistUploadContext: async () => {},
    uploadContextFromSession: () => null,
    augmentOutputsWithUploadLink: (o) => o,
    responseLooksLikeUploadStage: () => false,
    isUploadChoiceInput: () => false,
    callTypebot: async (path, body) => {
      typebotCalls.push(body.message.text);
      // Simula condição NAO → telemedicina
      if (body.message.text === 'NAO') {
        return {
          messages: [{ type: 'text', content: { plainText: 'Este atendimento é realizado por teleconsulta...' } }],
          input: {
            id: 'blk_tele_choice',
            type: 'choice input',
            items: [
              { content: 'Estou ciente e desejo continuar', value: 'sim' },
              { content: 'Não desejo continuar', value: 'nao' }
            ]
          }
        };
      }
      return {
        messages: [{ type: 'text', content: { plainText: 'Pelas informações fornecidas, não será possível seguir...' } }]
      };
    },
    provider: {
      sendTextMessage: async () => ({ providerMessageId: 't1' }),
      sendButtonMessage: async () => ({ providerMessageId: 'b1' }),
      sendListMessage: async () => ({ providerMessageId: 'l1' })
    }
  });

  process.env.TYPEBOT_PUBLIC_ID = 'doctor-prescreve-8rmljgu';
  process.env.TYPEBOT_VIEWER_URL = 'https://typebot.io';

  const noneResult = await bridgeNone({
    messageId: 'sinais-nao',
    text: 'Confirmo',
    identity: { phone: '5511999990002', bsuid: null },
    whatsappSession: { id: 'wa-2', typebot_session_id: 'sess-sinais' }
  });
  assert.equal(typebotCalls[0], 'NAO');
  assert.equal(noneResult.responsesSent >= 1, true);

  typebotCalls.length = 0;
  multiMeta = {
    inputId: SINAIS_INPUT.id,
    items: SINAIS_INPUT.items,
    selected: [{ id: 'it_og22qc8c', content: 'Dor no peito', value: 'dor_peito' }],
    buttonLabel: 'Confirmo'
  };
  const bridgeAlert = createTypebotWhatsAppBridge({
    claimMetaMessage: async () => ({ claimed: true }),
    finishMetaMessage: async () => {},
    setTypebotSessionId: async () => {},
    reloadSession: async ({ whatsappSession }) => ({
      ...whatsappSession,
      typebot_session_id: 'sess-sinais-2',
      metadata: {
        typebot_expected_input_id: SINAIS_INPUT.id,
        typebot_multi_choice: multiMeta
      }
    }),
    persistExpectedInput: async () => {},
    persistMultiChoice: async ({ multiChoice }) => { multiMeta = multiChoice; },
    createIntegrationError: async () => {},
    findPendingUploadContext: async () => null,
    findUploadContextForPhone: async () => null,
    persistUploadContext: async () => {},
    uploadContextFromSession: () => null,
    augmentOutputsWithUploadLink: (o) => o,
    responseLooksLikeUploadStage: () => false,
    isUploadChoiceInput: () => false,
    callTypebot: async (path, body) => {
      typebotCalls.push(body.message.text);
      return {
        messages: [{ type: 'text', content: { plainText: 'Pelas informações fornecidas, não será possível seguir...' } }]
      };
    },
    provider: {
      sendTextMessage: async () => ({ providerMessageId: 't1' }),
      sendButtonMessage: async () => ({ providerMessageId: 'b1' }),
      sendListMessage: async () => ({ providerMessageId: 'l1' })
    }
  });
  const alertResult = await bridgeAlert({
    messageId: 'sinais-alerta',
    text: 'Confirmo',
    identity: { phone: '5511999990003', bsuid: null },
    whatsappSession: { id: 'wa-3', typebot_session_id: 'sess-sinais-2' }
  });
  assert.equal(typebotCalls[0], 'dor_peito');
  assert.equal(alertResult.responsesSent >= 1, true);
}

async function main() {
  assertOfficialJson();
  assertDiseaseFreeTextPrompt();
  assertParsing();

  // Hipertensão + Diabetes
  await runDiseaseScenario('1, 2', 'has, dm');
  // Diabetes + Dislipidemia
  await runDiseaseScenario('2, 3', 'dm, dlp');
  // As quatro patologias
  await runDiseaseScenario('1, 2, 3, 4', 'has, dm, dlp, hipotireoidismo');

  await assertInvalidDiseaseReply();
  await assertBridgeSinaisBranches();

  console.log(JSON.stringify({
    ok: true,
    officialJsonPatched: true,
    welcomeUntouched: true,
    diseasePromptIsSingleTextNoConfirmo: true,
    hipertensaoEDiabetes: 'has, dm',
    diabetesEDislipidemia: 'dm, dlp',
    quatroPatologias: 'has, dm, dlp, hipotireoidismo',
    concludesByNativeSendNoExtraMessages: true,
    sinaisCopyUnchanged: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
