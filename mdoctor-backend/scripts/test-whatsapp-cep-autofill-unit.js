// Teste isolado (sem rede, sem banco) do autopreenchimento de endereço por
// CEP no bridge do WhatsApp — restaurado em 2026-08-29 (reverte a remoção do
// 6caca2b), na ordem de fluxo publicada em produção:
//   CEP (blk_0oydu2f7) -> blk_endereco_manual_msg -> endereço (q78qjnk6...)
//
// Turno 1: paciente informa o CEP. Se a ViaCEP encontra, o bridge NÃO deixa a
// mensagem "não foi possível localizar" chegar ao paciente — troca por
// "Localizamos ...", guarda os campos em metadata.cep_lookup e aponta o
// próximo input esperado para o marcador interno blk_endereco_numero_complemento.
// Turno 2: paciente responde número/complemento. O bridge monta o endereço
// completo (5 segmentos) a partir de metadata.cep_lookup + a resposta, e o
// envia ao input real de endereço do Typebot. Daí em diante, fluxo inalterado.
const assert = require('assert');
const { createTypebotWhatsAppBridge } = require('../src/services/typebot-whatsapp.bridge');

process.env.TYPEBOT_VIEWER_URL = 'https://viewer.example.test';
process.env.TYPEBOT_PUBLIC_ID = 'doctor-prescreve-8rmljgu';

const CEP_INPUT_ID = 'blk_0oydu2f7';
const ENDERECO_INPUT_ID = 'q78qjnk6ticwkeifl7xe2rju';
const SENTINEL = 'blk_endereco_numero_complemento';

const uploadBridgeMocks = {
  findPendingUploadContext: async () => null,
  findUploadContextForPhone: async () => null,
  findUploadContext: async () => null,
  persistUploadContext: async () => {},
  uploadContextFromSession: () => null,
  augmentOutputsWithUploadLink: (outputs) => outputs,
  responseLooksLikeUploadStage: () => false,
  isUploadChoiceInput: () => false,
  isUploadConfirmationText: () => false,
  getUploadStatus: async () => ({ upload_completed: false })
};

const identity = { phone: '5511999990000', bsuid: null, parentBsuid: null, username: null };

function makeBridge({ cepResult, onTypebotMessage }) {
  const session = {
    id: 'wa-cep-1',
    typebot_session_id: 'sess-cep-1',
    metadata: { typebot_expected_input_id: CEP_INPUT_ID }
  };
  const typebotCalls = [];
  const sentTexts = [];
  const receipts = new Set();

  const bridge = createTypebotWhatsAppBridge({
    ...uploadBridgeMocks,
    resolveMetaInboundRouting: async () => ({ handled: false, action: 'typebot' }),
    claimMetaMessage: async ({ messageId }) => {
      if (receipts.has(messageId)) return { claimed: false };
      receipts.add(messageId);
      return { claimed: true };
    },
    finishMetaMessage: async () => {},
    setTypebotSessionId: async () => {},
    now: () => new Date('2026-08-29T12:00:00.000Z'),
    lookupCep: async () => cepResult,
    reloadSession: async () => session,
    persistExpectedInput: async ({ inputId, extraMetadataPatch = {} }) => {
      session.metadata = {
        ...session.metadata,
        typebot_expected_input_id: inputId || null,
        ...extraMetadataPatch
      };
    },
    createIntegrationError: async () => {},
    callTypebot: async (path, body) => {
      typebotCalls.push({ path, text: body?.message?.text });
      return onTypebotMessage
        ? onTypebotMessage(body?.message?.text)
        : {
            messages: [{ type: 'text', content: { plainText: 'Não foi possível localizar automaticamente o endereço. Informe seu endereço completo.' } }],
            input: { id: ENDERECO_INPUT_ID, type: 'text input' }
          };
    },
    provider: {
      sendTextMessage: async ({ text }) => { sentTexts.push(text); return { providerMessageId: `m-${sentTexts.length}` }; },
      sendButtonMessage: async () => ({}),
      sendListMessage: async () => ({}),
      sendCtaUrlMessage: async () => ({})
    }
  });

  return { bridge, session, typebotCalls, sentTexts };
}

async function main() {
  const results = {};

  // ---- Cenário 1: CEP encontrado -> autofill em 2 turnos ----
  {
    const cepResult = {
      logradouro: 'Rua Aurora', bairro: 'Santa Efigênia',
      cidade: 'São Paulo', estado: 'SP', cep: '01209003', encontrado: true
    };
    const { bridge, session, typebotCalls, sentTexts } = makeBridge({ cepResult });

    // Turno 1: envia o CEP
    await bridge({ messageId: 'cep-1', text: '01209003', identity, whatsappSession: session });

    assert.equal(typebotCalls.length, 1, 'turno 1: 1 chamada ao Typebot');
    assert.equal(typebotCalls[0].text, '01209003', 'o CEP normalizado é enviado ao Typebot');
    assert.equal(sentTexts.length, 1, 'turno 1: 1 mensagem ao paciente');
    assert.ok(/Localizamos o seguinte endereço/.test(sentTexts[0]), 'mostra a confirmação do endereço encontrado');
    assert.ok(/Rua Aurora/.test(sentTexts[0]) && /Santa Efigênia/.test(sentTexts[0]) && /São Paulo/.test(sentTexts[0]) && /SP/.test(sentTexts[0]), 'confirmação traz rua/bairro/cidade/UF');
    assert.ok(!/não foi possível localizar/i.test(sentTexts[0]), 'não vaza a mensagem "não localizado" do Typebot');
    assert.equal(session.metadata.typebot_expected_input_id, SENTINEL, 'próximo input esperado vira o marcador interno');
    assert.deepEqual(session.metadata.cep_lookup, cepResult, 'cep_lookup guardado na sessão');
    results.turno1_cepEncontrado_confirmaEArmaSentinela = 'ok';

    // Turno 2: envia número e complemento
    await bridge({ messageId: 'cep-2', text: '965, apto 2', identity, whatsappSession: session });

    assert.equal(typebotCalls.length, 2, 'turno 2: 2ª chamada ao Typebot');
    assert.equal(
      typebotCalls[1].text,
      'Rua Aurora, 965 apto 2, Santa Efigênia, São Paulo, SP',
      'turno 2: endereço completo (5 segmentos, vírgula do complemento vira espaço) enviado ao input real'
    );
    assert.equal(session.metadata.cep_lookup, null, 'cep_lookup limpo após consumir');
    results.turno2_montaEnderecoCompletoEEnviaAoInputReal = 'ok';
  }

  // ---- Cenário 2: CEP NÃO encontrado -> caminho manual inalterado ----
  {
    const { bridge, session, typebotCalls, sentTexts } = makeBridge({
      cepResult: { logradouro: '', bairro: '', cidade: '', estado: '', cep: '00000000', encontrado: false }
    });

    await bridge({ messageId: 'cep-nf-1', text: '00000000', identity, whatsappSession: session });

    assert.equal(typebotCalls.length, 1);
    assert.equal(typebotCalls[0].text, '00000000');
    assert.ok(/não foi possível localizar/i.test(sentTexts[0]), 'CEP não encontrado: mensagem do Typebot passa direto');
    assert.equal(session.metadata.typebot_expected_input_id, ENDERECO_INPUT_ID, 'não encontrado: próximo input é o real, não o marcador');
    assert.ok(!session.metadata.cep_lookup, 'não encontrado: nada guardado');
    results.cepNaoEncontrado_caminhoManualInalterado = 'ok';
  }

  // ---- Cenário 3: turno 2 com marcador mas sem cep_lookup (sessão antiga) ----
  {
    const { bridge, session, typebotCalls } = makeBridge({ cepResult: { encontrado: false } });
    session.metadata = { typebot_expected_input_id: SENTINEL }; // sem cep_lookup

    await bridge({ messageId: 'cep-legacy-2', text: 'Rua das Palmeiras, 10, Centro, Campinas, SP', identity, whatsappSession: session });

    assert.equal(typebotCalls.length, 1);
    assert.ok(/Rua das Palmeiras/.test(typebotCalls[0].text) && /Campinas/.test(typebotCalls[0].text), 'sem cep_lookup: envia o endereço digitado pelo paciente ao input real');
    assert.equal(session.metadata.typebot_expected_input_id, ENDERECO_INPUT_ID);
    results.turno2SemCepLookup_naoTrava = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
  const falhas = Object.entries(results).filter(([, v]) => v !== 'ok');
  if (falhas.length) { console.error('FALHAS:', falhas); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
