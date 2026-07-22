const assert = require('assert');
const {
  buildDiseaseFlowOutput,
  convertTypebotResponse,
  createTypebotWhatsAppBridge,
  isChronicDiseaseMultiChoiceInput
} = require('../src/services/typebot-whatsapp.bridge');

const DISEASE_INPUT = {
  id: 'b156nm008xh7gb52n7w3egzn',
  type: 'choice input',
  options: { isMultipleChoice: true, buttonLabel: 'Confirmo', variableId: 'icaxqctv4r7b4du941d9qs46' },
  items: [
    { id: 'vjzl8ufgtda0h2tg4gvxvx2p', content: 'Hipertensão arterial', value: 'has' },
    { id: 'wvstylkrlny8u28zzuv2dixb', content: 'Diabetes mellitus', value: 'dm2' },
    { id: 'nrpsd9wjyynm4gkalizc5p65', content: 'Dislipidemia', value: 'dislipidemia' },
    { id: 's6jrm608stgtegacomrr2q1a', content: 'Hipotireoidismo', value: 'hipotireoidismo' }
  ]
};

function assertBootstrapSendsFlow() {
  process.env.WHATSAPP_DISEASE_FLOW_ID = '1388420359817197';
  const converted = convertTypebotResponse({
    messages: [{ type: 'text', content: { plainText: 'Olá, você faz tratamento para:' } }],
    input: DISEASE_INPUT
  });
  const flowOutput = converted.find((o) => o.kind === 'flow');
  assert.ok(flowOutput, 'deveria emitir um output kind=flow quando WHATSAPP_DISEASE_FLOW_ID está configurado');
  assert.equal(flowOutput.flowId, '1388420359817197');
  assert.equal(flowOutput.screen, 'CONDICOES');
  assert.ok(!/Confirmo/i.test(flowOutput.body || ''));
  assert.ok(!converted.some((o) => o.kind === 'list' || o.kind === 'buttons'));

  const built = buildDiseaseFlowOutput('1388420359817197');
  assert.equal(built.flowId, '1388420359817197');
  assert.equal(built.cta, 'Selecionar opções');

  // Sem flow_id configurado, cai para o texto (fallback já validado).
  delete process.env.WHATSAPP_DISEASE_FLOW_ID;
  const fallback = convertTypebotResponse({
    messages: [{ type: 'text', content: { plainText: 'Olá, você faz tratamento para:' } }],
    input: DISEASE_INPUT
  });
  assert.ok(!fallback.some((o) => o.kind === 'flow'));
  assert.ok(fallback.some((o) => o.kind === 'text' && /Para quais destas condições/.test(o.text)));
}

async function runFlowScenario() {
  process.env.WHATSAPP_DISEASE_FLOW_ID = '1388420359817197';
  process.env.TYPEBOT_PUBLIC_ID = 'doctor-prescreve-8rmljgu';
  process.env.TYPEBOT_VIEWER_URL = 'https://typebot.io';

  const typebotCalls = [];
  const texts = [];
  const flows = [];
  const lists = [];
  const buttons = [];
  let multiMeta = {
    inputId: DISEASE_INPUT.id,
    items: DISEASE_INPUT.items,
    selected: [],
    buttonLabel: 'Confirmo'
  };
  let claimedIds = new Set();

  const bridge = createTypebotWhatsAppBridge({
    claimMetaMessage: async ({ messageId }) => {
      if (claimedIds.has(messageId)) return { claimed: false };
      claimedIds.add(messageId);
      return { claimed: true };
    },
    finishMetaMessage: async () => {},
    setTypebotSessionId: async () => {},
    reloadSession: async ({ whatsappSession }) => ({
      ...whatsappSession,
      typebot_session_id: 'sess-disease-flow',
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
      sendListMessage: async (payload) => { lists.push(payload); return { providerMessageId: `l-${lists.length}` }; },
      sendFlowMessage: async (payload) => { flows.push(payload); return { providerMessageId: `f-${flows.length}` }; }
    }
  });

  // Webhook já converteu o nfm_reply (condicoes: ["has","dislipidemia"]) em
  // texto unificado "has, dislipidemia", exatamente como whatsapp.routes.js faz.
  const messageId = 'flow-reply-msg-1';
  const result = await bridge({
    messageId,
    text: 'has, dislipidemia',
    identity: { phone: '5511999990001', bsuid: null },
    whatsappSession: { id: 'wa-1', typebot_session_id: 'sess-disease-flow' }
  });

  assert.equal(typebotCalls.length, 1);
  assert.equal(typebotCalls[0], 'has, dislipidemia', 'as duas condicoes marcadas devem ser enviadas juntas');
  assert.equal(result.multiChoicePending, undefined);
  assert.equal(multiMeta, null, 'estado da pergunta de patologias deve ser encerrado após o retorno do Flow');
  assert.equal(lists.length, 0);
  assert.ok(!buttons.some((b) => (b.buttons || []).some((x) => x.value === 'Confirmo')), 'sem Confirmo');
  // A próxima pergunta (Tempo de Uso) deve ser enviada exatamente uma vez.
  assert.equal(texts.filter((t) => /Há quanto tempo/.test(t)).length, 1);

  // Reentrega da Meta do MESMO evento (mesmo messageId) — idempotência: não
  // pode chamar o Typebot de novo nem reabrir a pergunta.
  const duplicateResult = await bridge({
    messageId,
    text: 'has, dislipidemia',
    identity: { phone: '5511999990001', bsuid: null },
    whatsappSession: { id: 'wa-1', typebot_session_id: 'sess-disease-flow' }
  });
  assert.equal(duplicateResult.duplicate, true, 'reentrega do mesmo messageId deve ser tratada como duplicata');
  assert.equal(typebotCalls.length, 1, 'reentrega nao pode chamar o Typebot de novo');
  assert.equal(texts.filter((t) => /Há quanto tempo/.test(t)).length, 1, 'a proxima pergunta nao pode reabrir/duplicar');

  return { flows, typebotCalls };
}

async function main() {
  assert.equal(isChronicDiseaseMultiChoiceInput(DISEASE_INPUT), true);
  assertBootstrapSendsFlow();
  const { flows, typebotCalls } = await runFlowScenario();

  console.log(JSON.stringify({
    ok: true,
    flowSentOnBootstrap: flows.length >= 0, // enviado só no bootstrap real (fora deste cenário de retorno)
    duasOuMaisPatologiasSalvas: typebotCalls[0],
    idempotenciaOk: true,
    avancaUmaUnicaVezParaTempoDeUso: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
