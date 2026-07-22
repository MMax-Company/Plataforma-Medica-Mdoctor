const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildMultiChoiceSubmitText,
  buildMultiChoiceOutputs,
  convertTypebotResponse,
  createTypebotWhatsAppBridge,
  DISEASE_MULTI_CHOICE_INTRO,
  isChronicDiseaseMultiChoiceInput,
  isMultipleChoiceInput,
  multiChoiceSummary,
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

function assertDiseaseUxCopy() {
  assert.equal(isChronicDiseaseMultiChoiceInput(DISEASE_INPUT), true);
  assert.equal(isChronicDiseaseMultiChoiceInput(SINAIS_INPUT), false);

  const firstOutputs = buildMultiChoiceOutputs(DISEASE_INPUT, []);
  assert.equal(firstOutputs[0].kind, 'text');
  assert.equal(firstOutputs[0].text, DISEASE_MULTI_CHOICE_INTRO);
  assert.ok(DISEASE_MULTI_CHOICE_INTRO.includes('mais de uma condição'));
  assert.ok(DISEASE_MULTI_CHOICE_INTRO.includes('Confirmo'));
  const firstList = firstOutputs.find((o) => o.kind === 'list');
  assert.ok(firstList);
  // Confirmo não é uma 5ª doença dentro da lista clínica.
  assert.equal(firstList.choices.length, 4);
  assert.ok(!firstList.choices.some((c) => c.value === 'Confirmo'));
  const firstConfirmButtons = firstOutputs.find((o) => o.kind === 'buttons');
  assert.ok(firstConfirmButtons);
  assert.ok(firstConfirmButtons.choices.some((c) => c.value === 'Confirmo'));

  const converted = convertTypebotResponse({
    messages: [{ type: 'text', content: { plainText: 'Olá, você faz tratamento para:' } }],
    input: DISEASE_INPUT
  });
  const introCount = converted.filter((o) => o.kind === 'text' && o.text === DISEASE_MULTI_CHOICE_INTRO).length;
  assert.equal(introCount, 1);

  const selectedTwo = [
    { id: 'vjzl8ufgtda0h2tg4gvxvx2p', content: 'Hipertensão Arterial', value: 'has' },
    { id: 'wvstylkrlny8u28zzuv2dixb', content: 'Diabetes Melitus', value: 'dm' }
  ];
  assert.equal(
    multiChoiceSummary(selectedTwo, DISEASE_INPUT),
    'Selecionadas até agora: Hipertensão Arterial, Diabetes Melitus.'
  );

  // Sinais de alerta mantém copy antiga
  const sinaisOutputs = buildMultiChoiceOutputs(SINAIS_INPUT, []);
  assert.ok(!sinaisOutputs.some((o) => o.text === DISEASE_MULTI_CHOICE_INTRO));
  assert.equal(
    multiChoiceSummary([{ content: 'Dor no peito', value: 'dor_peito' }], SINAIS_INPUT),
    'Selecionado: Dor no peito'
  );
}

async function assertConfirmSubmit(values, expectedSubmit) {
  const selected = DISEASE_INPUT.items
    .filter((item) => values.includes(item.value))
    .map((item) => ({ id: item.id, content: item.content, value: item.value }));
  const typebotCalls = [];
  let multiMeta = {
    inputId: DISEASE_INPUT.id,
    items: DISEASE_INPUT.items,
    selected,
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
      typebotCalls.push({ path, body });
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
      sendTextMessage: async () => ({ providerMessageId: 't1' }),
      sendButtonMessage: async () => ({ providerMessageId: 'b1' }),
      sendListMessage: async () => ({ providerMessageId: 'l1' })
    }
  });

  process.env.TYPEBOT_PUBLIC_ID = 'doctor-prescreve-8rmljgu';
  process.env.TYPEBOT_VIEWER_URL = 'https://typebot.io';

  const confirmed = await bridge({
    messageId: `multi-disease-confirm-${values.join('-')}-${Date.now()}`,
    text: 'Confirmo',
    identity: { phone: '5511999990001', bsuid: null },
    whatsappSession: { id: 'wa-1', typebot_session_id: 'sess-disease' }
  });
  assert.equal(typebotCalls.length, 1);
  assert.equal(typebotCalls[0].body.message.text, expectedSubmit);
  assert.equal(confirmed.multiChoicePending, undefined);
}

async function assertBridgeMultiDisease() {
  assert.equal(isMultipleChoiceInput(DISEASE_INPUT), true);
  const outputs = convertTypebotResponse({
    messages: [{ type: 'text', content: { plainText: 'Olá, você faz tratamento para:' } }],
    input: DISEASE_INPUT
  });
  assert.ok(outputs.some((o) => o.kind === 'text' && o.text === DISEASE_MULTI_CHOICE_INTRO));
  const list = outputs.find((o) => o.kind === 'list');
  assert.ok(list);
  // A lista de doenças não deve conter Confirmo como se fosse uma 5ª condição.
  assert.ok(!list.choices.some((c) => c.title === 'Confirmo' || c.value === 'Confirmo'));
  assert.equal(list.choices.length, 4);
  const confirmButtons = outputs.find((o) => o.kind === 'buttons');
  assert.ok(confirmButtons);
  assert.ok(confirmButtons.choices.some((c) => c.title === 'Confirmo' || c.value === 'Confirmo'));

  let state = {
    inputId: DISEASE_INPUT.id,
    items: DISEASE_INPUT.items,
    selected: [],
    buttonLabel: 'Confirmo'
  };
  state = toggleMultiChoiceSelection(state, 'Hipertensão Arterial').state;
  state = toggleMultiChoiceSelection(state, 'Diabetes Melitus').state;
  assert.deepEqual(state.selected.map((s) => s.value), ['has', 'dm']);
  assert.equal(buildMultiChoiceSubmitText(state.selected), 'has, dm');

  const single = toggleMultiChoiceSelection({
    inputId: DISEASE_INPUT.id,
    items: DISEASE_INPUT.items,
    selected: [],
    buttonLabel: 'Confirmo'
  }, 'Dislipidemia').state;
  assert.equal(buildMultiChoiceSubmitText(single.selected), 'dlp');

  // Uma patologia → Confirmo
  await assertConfirmSubmit(['dlp'], 'dlp');
  // Duas patologias
  await assertConfirmSubmit(['has', 'dm'], 'has, dm');
  // Quatro patologias
  await assertConfirmSubmit(['has', 'dm', 'dlp', 'hipotireoidismo'], 'has, dm, dlp, hipotireoidismo');
}

async function assertAccumulateAndRelist() {
  let multiMeta = {
    inputId: DISEASE_INPUT.id,
    items: DISEASE_INPUT.items,
    selected: [],
    buttonLabel: 'Confirmo'
  };
  const texts = [];
  const lists = [];
  const buttons = [];
  const typebotCalls = [];

  const bridge = createTypebotWhatsAppBridge({
    claimMetaMessage: async () => ({ claimed: true }),
    finishMetaMessage: async () => {},
    setTypebotSessionId: async () => {},
    reloadSession: async ({ whatsappSession }) => ({
      ...whatsappSession,
      typebot_session_id: 'sess-disease-acc',
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
        messages: [{ type: 'text', content: { plainText: 'Próximo passo' } }],
        input: { id: 'next', type: 'choice input', items: [{ content: 'ok' }] }
      };
    },
    provider: {
      sendTextMessage: async ({ text }) => {
        texts.push(text);
        return { providerMessageId: `t-${texts.length}` };
      },
      sendButtonMessage: async (payload) => {
        buttons.push(payload);
        return { providerMessageId: `b-${buttons.length}` };
      },
      sendListMessage: async (payload) => {
        lists.push(payload);
        return { providerMessageId: `l-${lists.length}` };
      }
    }
  });

  process.env.TYPEBOT_PUBLIC_ID = 'doctor-prescreve-8rmljgu';
  process.env.TYPEBOT_VIEWER_URL = 'https://typebot.io';

  const pick = async (label, messageId) => {
    const textsBefore = texts.length;
    const result = await bridge({
      messageId,
      text: label,
      identity: { phone: '5511999990099', bsuid: null },
      whatsappSession: { id: 'wa-acc', typebot_session_id: 'sess-disease-acc' }
    });
    assert.equal(result.multiChoicePending, true);
    assert.ok(lists.length > 0);
    // Patologias não mandam mais o resumo como texto avulso (duplicava o
    // corpo da lista) — nenhuma mensagem de texto nova por escolha.
    assert.equal(texts.length, textsBefore, 'não deveria enviar texto avulso de resumo para patologias');
  };

  await pick('Hipertensão Arterial', 'acc-1');
  assert.equal(lists[lists.length - 1].body, 'Selecionadas até agora: Hipertensão Arterial.');
  assert.deepEqual(multiMeta.selected.map((s) => s.value), ['has']);

  await pick('Diabetes Melitus', 'acc-2');
  assert.equal(
    lists[lists.length - 1].body,
    'Selecionadas até agora: Hipertensão Arterial, Diabetes Melitus.'
  );
  assert.deepEqual(multiMeta.selected.map((s) => s.value), ['has', 'dm']);

  await pick('Dislipidemia', 'acc-3');
  await pick('Hipotireidismo', 'acc-4');
  assert.deepEqual(multiMeta.selected.map((s) => s.value), ['has', 'dm', 'dlp', 'hipotireoidismo']);
  assert.equal(
    lists[lists.length - 1].body,
    'Selecionadas até agora: Hipertensão Arterial, Diabetes Melitus, Dislipidemia, Hipotireidismo.'
  );
  assert.equal(lists.length, 4);
  // Nenhuma doença é apagada ao acumular: cada lista sempre traz as 4 opções clínicas.
  assert.ok(lists.every((list) => (list.rows || []).length === 4));
  // Confirmo nunca é uma linha da lista de doenças.
  assert.ok(lists.every((list) => !(list.rows || []).some((row) => row.value === 'Confirmo' || row.title === 'Confirmo')));
  // Confirmo chega em mensagem de botão separada, uma por escolha.
  assert.equal(buttons.length, 4);
  assert.ok(buttons.every((btn) => (btn.buttons || []).some((b) => b.value === 'Confirmo' || b.title === 'Confirmo')));

  const confirmed = await bridge({
    messageId: 'acc-confirm',
    text: 'Confirmo',
    identity: { phone: '5511999990099', bsuid: null },
    whatsappSession: { id: 'wa-acc', typebot_session_id: 'sess-disease-acc' }
  });
  assert.equal(typebotCalls[0], 'has, dm, dlp, hipotireoidismo');
  assert.equal(confirmed.multiChoicePending, undefined);
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
  assertDiseaseUxCopy();
  await assertBridgeMultiDisease();
  await assertAccumulateAndRelist();
  await assertBridgeSinaisBranches();
  console.log(JSON.stringify({
    ok: true,
    officialJsonPatched: true,
    welcomeUntouched: true,
    diseaseIntroCopy: true,
    selectedUntilNowCopy: true,
    sinaisCopyUnchanged: true,
    twoDiseasesSubmit: 'has, dm',
    oneDiseaseSubmit: 'dlp',
    fourDiseasesSubmit: 'has, dm, dlp, hipotireoidismo',
    accumulationAndRelist: true,
    nenhumDestesSubmitsNAO: true,
    signalSubmitsValue: true,
    nenhumExclusive: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
