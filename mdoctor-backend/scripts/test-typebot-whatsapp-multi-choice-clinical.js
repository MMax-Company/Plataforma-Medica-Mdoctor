const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  convertTypebotResponse,
  createTypebotWhatsAppBridge
} = require('../src/services/typebot-whatsapp.bridge');

// Doença Crônica (b156nm008xh7gb52n7w3egzn) NÃO usa mais lista+Confirmo desde
// 3a786ef (24/07): o Typebot publicado converteu esse bloco para text input
// (pergunta com opções numeradas no próprio texto, resposta livre "1, 3").
// Ver assertChronicConditionsFreeText().
const DISEASE_TEXT_INPUT = {
  id: 'b156nm008xh7gb52n7w3egzn',
  type: 'text input'
};

// Sinais de Alerta (s5VQGsVF4hQgziQsXVdwPDW): confirmado via API do Typebot
// publicado que o campo isMultipleChoice:true não tem contrapartida real de
// seleção múltipla no WhatsApp (nem nunca teve no fluxo homologado, commit
// 21b5463) — o mecanismo de lista+Confirmo/acumulação (removido nesta
// restauração) era uma adição própria da main, não validada, e causava loop.
// Comportamento homologado: escolha única e imediata, igual a qualquer outro
// choice input do bot (ex.: LGPD, Telemedicina) — a linha selecionada já
// envia a resposta ao Typebot, sem etapa de confirmação.
const SINAIS_INPUT = {
  id: 's5VQGsVF4hQgziQsXVdwPDW',
  type: 'choice input',
  options: { isMultipleChoice: true, variableId: 'he7ry4ccuhoyy3k2p11ryeuc' },
  items: [
    { id: 'it_og22qc8c', content: 'Dor no peito', value: 'dor_peito' },
    { id: 'it_wbbj4nvy', content: 'Falta de ar', value: 'falta_ar' },
    { id: 'it_mnd00o3r', content: 'Desmaio', value: 'desmaio' },
    { id: 'it_im14r5sw', content: 'Febre alta persistente', value: 'febre' },
    { id: 'it_dbk5a6g7', content: 'Sangramento', value: 'sangramento' },
    { id: 'it_l4dxjewc', content: 'Nenhum sinal/sintoma', value: 'NAO' }
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

  // Doença Crônica: fixture docs/typebot/typebot-doctor-prescreve-staging-safe.json
  // é um snapshot anterior a 3a786ef (24/07) e não reflete mais o bot
  // publicado (esse bloco virou text input, ver assertChronicConditionsFreeText).
  // Não asserida aqui para não travar o teste num artefato de docs desatualizado.

  const sinais = bot.groups.find((g) => g.title === 'Sinais de Alerta');
  const cond = sinais.blocks.find((b) => b.type === 'Condition');
  const item = cond.items[0];
  assert.equal(item.content.comparisons[0].value, 'NAO');
  assert.equal(item.outgoingEdgeId, 'edge_sinais_to_telemedicine');
  assert.ok(bot.edges.some((e) => e.id === 'edge_sinais_to_telemedicine'));
  assert.ok(!bot.edges.some((e) => e.id === 'o51d9l56lzldmzcuvc0jdg6y'));
}

async function assertChronicConditionsFreeText() {
  // Regressão coberta aqui (PR #36/#37): forçar este input no mecanismo de
  // lista+Confirmo gerava uma lista sem os itens reais (Typebot não manda
  // input.items para text input), travando o fluxo em loop. Homologado:
  // pergunta com opções numeradas no texto, resposta livre convertida em
  // códigos por validateChronicConditions.
  const outputs = convertTypebotResponse({
    messages: [{ type: 'text', content: { plainText: 'Olá, você faz tratamento para:\n1. Hipertensão Arterial\n2. Diabetes Melitus\n3. Dislipidemia\n4. Hipotireidismo\n\nDigite os números correspondentes separados por vírgula (ex.: 1, 3). Pode escolher mais de uma opção.' } }],
    input: DISEASE_TEXT_INPUT
  });
  assert.ok(outputs.every((o) => o.kind === 'text'));
  assert.ok(!outputs.some((o) => o.kind === 'list' || o.kind === 'buttons'));

  function makeBridge(typebotCalls) {
    return createTypebotWhatsAppBridge({
      claimMetaMessage: async () => ({ claimed: true }),
      finishMetaMessage: async () => {},
      setTypebotSessionId: async () => {},
      reloadSession: async ({ whatsappSession }) => ({
        ...whatsappSession,
        typebot_session_id: 'sess-disease',
        metadata: { typebot_expected_input_id: DISEASE_TEXT_INPUT.id }
      }),
      persistExpectedInput: async () => {},
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
  }

  process.env.TYPEBOT_PUBLIC_ID = 'doctor-prescreve-8rmljgu';
  process.env.TYPEBOT_VIEWER_URL = 'https://typebot.io';

  const validCalls = [];
  const answered = await makeBridge(validCalls)({
    messageId: 'disease-free-text',
    text: '1, 3',
    identity: { phone: '5511999990001', bsuid: null },
    whatsappSession: { id: 'wa-1', typebot_session_id: 'sess-disease' }
  });
  assert.equal(validCalls.length, 1);
  assert.equal(validCalls[0].body.message.text, 'has,dlp');
  assert.equal(answered.multiChoicePending, undefined);

  // Opção inválida deve ser rejeitada com a pergunta original, sem chamar o
  // Typebot — instância própria de bridge (expectedInputs em memória é por
  // instância, não deve carregar o avanço de sessão do caso anterior).
  const invalidCalls = [];
  const rejected = await makeBridge(invalidCalls)({
    messageId: 'disease-free-text-invalid',
    text: '9',
    identity: { phone: '5511999990002', bsuid: null },
    whatsappSession: { id: 'wa-2', typebot_session_id: 'sess-disease' }
  });
  assert.equal(invalidCalls.length, 0);
  assert.equal(rejected.responsesSent >= 1, true);
}

async function assertBridgeSinaisBranches() {
  // convertTypebotResponse deve gerar uma lista de seleção única (6 itens > 3
  // vira "list", nunca "buttons"), sem nenhuma etapa de Confirmo/acumulação.
  const outputs = convertTypebotResponse({
    messages: [{ type: 'text', content: { plainText: 'Você sente algum destes sinais?' } }],
    input: SINAIS_INPUT
  });
  const list = outputs.find((o) => o.kind === 'list');
  assert.ok(list, 'esperava um output kind=list');
  assert.ok(!list.choices.some((c) => c.title === 'Confirmo' || c.value === 'Confirmo'));
  assert.deepEqual(list.choices.map((c) => c.title), [
    'Dor no peito', 'Falta de ar', 'Desmaio', 'Febre alta persistente', 'Sangramento', 'Nenhum sinal/sintoma'
  ]);

  function makeBridge(typebotCalls, callTypebotImpl) {
    return createTypebotWhatsAppBridge({
      claimMetaMessage: async () => ({ claimed: true }),
      finishMetaMessage: async () => {},
      setTypebotSessionId: async () => {},
      reloadSession: async ({ whatsappSession }) => ({
        ...whatsappSession,
        typebot_session_id: 'sess-sinais',
        metadata: { typebot_expected_input_id: SINAIS_INPUT.id }
      }),
      persistExpectedInput: async () => {},
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
        return callTypebotImpl(body.message.text);
      },
      provider: {
        sendTextMessage: async () => ({ providerMessageId: 't1' }),
        sendButtonMessage: async () => ({ providerMessageId: 'b1' }),
        sendListMessage: async () => ({ providerMessageId: 'l1' })
      }
    });
  }

  process.env.TYPEBOT_PUBLIC_ID = 'doctor-prescreve-8rmljgu';
  process.env.TYPEBOT_VIEWER_URL = 'https://typebot.io';

  // Escolha única e imediata: o texto do list_reply (título/conteúdo do item,
  // ex.: "Nenhum sinal/sintoma") já vai direto ao Typebot no mesmo turno —
  // sem esperar um "Confirmo" separado.
  const noneCalls = [];
  const noneResult = await makeBridge(noneCalls, (text) => {
    if (text === 'Nenhum sinal/sintoma') {
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
    return { messages: [{ type: 'text', content: { plainText: 'inesperado' } }] };
  })({
    messageId: 'sinais-nenhum',
    text: 'Nenhum sinal/sintoma',
    identity: { phone: '5511999990002', bsuid: null },
    whatsappSession: { id: 'wa-2', typebot_session_id: 'sess-sinais' }
  });
  assert.equal(noneCalls.length, 1);
  assert.equal(noneCalls[0], 'Nenhum sinal/sintoma');
  assert.equal(noneResult.responsesSent >= 1, true);

  const alertCalls = [];
  const alertResult = await makeBridge(alertCalls, () => ({
    messages: [{ type: 'text', content: { plainText: 'Pelas informações fornecidas, não será possível seguir...' } }]
  }))({
    messageId: 'sinais-alerta',
    text: 'Dor no peito',
    identity: { phone: '5511999990003', bsuid: null },
    whatsappSession: { id: 'wa-3', typebot_session_id: 'sess-sinais-2' }
  });
  assert.equal(alertCalls.length, 1);
  assert.equal(alertCalls[0], 'Dor no peito');
  assert.equal(alertResult.responsesSent >= 1, true);
}

async function main() {
  assertOfficialJson();
  await assertChronicConditionsFreeText();
  await assertBridgeSinaisBranches();
  console.log(JSON.stringify({
    ok: true,
    welcomeUntouched: true,
    chronicConditionsIsFreeText: true,
    chronicConditionsSubmit: 'has,dlp',
    sinaisIsSingleSelectList: true,
    sinaisSelectionSubmitsImmediately: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
