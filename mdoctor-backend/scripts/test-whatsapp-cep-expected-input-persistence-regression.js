// Teste de regressão isolado (sem rede, sem banco real) para o autopreenchimento
// de endereço por CEP no bridge do WhatsApp — pedido: confirmar se
// typebot_expected_input_id (blk_0oydu2f7) sobrevive à persistência/reload
// REAL (whatsapp-sessions.store.js: upsertSessionIdentity/getSessionByPhone),
// não a um mock de sessão mantido só em memória local pelo teste.
//
// Diferença deliberada do teste existente
// (scripts/test-whatsapp-cep-autofill-unit.js): aquele pré-semeia
// session.metadata.typebot_expected_input_id = CEP_INPUT_ID e substitui
// persistExpectedInput/reloadSession por um mock local — nunca exercita o
// turno ANTERIOR (onde o próprio Typebot retorna input.id = blk_0oydu2f7 e o
// bridge precisa persistir isso de verdade) nem o round-trip real pelo
// store (upsertSessionIdentity -> getSessionByPhone), que é onde a hipótese
// de regressão de persistência/reload estaria, se existisse.
//
// Este teste usa createTypebotWhatsAppBridge SEM sobrescrever
// persistExpectedInput/reloadSession (deps reais do bridge), com
// whatsapp-sessions.store.js real por cima de um FakeSupabaseClient
// (scripts/_fakes/fake-supabase-client.js) — sem rede, sem Supabase real.
const assert = require('assert');
const path = require('path');
const { FakeSupabaseClient } = require('./_fakes/fake-supabase-client');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

process.env.TYPEBOT_VIEWER_URL = 'https://viewer.example.test';
process.env.TYPEBOT_PUBLIC_ID = 'doctor-prescreve-8rmljgu';

// Substitui src/config/supabase.js por um fake em memória ANTES de qualquer
// require de src/store/whatsapp-sessions.store.js (que passa por
// src/db/persistence.js -> src/config/supabase.js) — evita a dependência de
// rede/driver real ('ws') e exercita o merge de metadata de verdade
// (upsertSessionIdentity) a cada turno, como em produção.
const fakeClient = new FakeSupabaseClient();
stub(path.join(__dirname, '..', 'src', 'config', 'supabase.js'), {
  getSupabase: () => fakeClient,
  isSupabaseConfigured: () => true
});

const { createTypebotWhatsAppBridge } = require('../src/services/typebot-whatsapp.bridge');
const { getSessionByPhone } = require('../src/store/whatsapp-sessions.store');

const PREVIOUS_INPUT_ID = 'blk_pergunta_anterior_generica'; // input qualquer anterior ao CEP — irrelevante ao teste, só precisa existir
const CEP_INPUT_ID = 'blk_0oydu2f7';
const SENTINEL = 'blk_endereco_numero_complemento';
const ENDERECO_INPUT_ID = 'q78qjnk6ticwkeifl7xe2rju'; // input real de endereço do Typebot (mesma constante do bridge)

function makeIdentity(phone) {
  return { phone, bsuid: null, parentBsuid: null, username: null };
}

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

function makeBridge({ typebotScript, lookupCepResult }) {
  const typebotCalls = [];
  const sentTexts = [];
  const receipts = new Set();
  let scriptIndex = 0;

  const bridge = createTypebotWhatsAppBridge({
    ...uploadBridgeMocks,
    resolveMetaInboundRouting: async () => ({ handled: false, action: 'typebot' }),
    handleTypebotSupportChoice: async () => ({ action: 'noop' }),
    claimMetaMessage: async ({ messageId }) => {
      if (receipts.has(messageId)) return { claimed: false };
      receipts.add(messageId);
      return { claimed: true };
    },
    finishMetaMessage: async () => {},
    setTypebotSessionId: async ({ sessionId, typebotSessionId }) => {
      // Mesma escrita que o default real faria, mas sem depender do store de
      // sessões completo — só o campo typebot_session_id interessa aqui.
      const row = fakeClient.rows('whatsapp_sessions').find((r) => r.id === sessionId);
      if (row) row.typebot_session_id = typebotSessionId;
    },
    now: () => new Date('2026-10-25T12:00:00.000Z'),
    lookupCep: async () => lookupCepResult,
    createIntegrationError: async () => {},
    callTypebot: async (path_, body) => {
      typebotCalls.push({ path: path_, text: body?.message?.text });
      const step = typebotScript[scriptIndex];
      scriptIndex += 1;
      return step(body);
    },
    provider: {
      sendTextMessage: async ({ text }) => { sentTexts.push(text); return { providerMessageId: `m-${sentTexts.length}` }; },
      sendButtonMessage: async () => ({}),
      sendListMessage: async () => ({}),
      sendCtaUrlMessage: async () => ({})
    }
  });

  return { bridge, typebotCalls, sentTexts };
}

// Cada cenário usa um telefone próprio: getSessionByPhone (produção) busca
// "a sessão mais recente deste telefone" — reaproveitar o mesmo número entre
// cenários independentes faria um cenário enxergar a linha de outro.
function seedSession({ id, phone, typebotSessionId, expectedInputId }) {
  const row = {
    id,
    phone,
    bsuid: null,
    parent_bsuid: null,
    username: null,
    patient_id: null,
    provider: 'meta',
    status: 'active',
    typebot_session_id: typebotSessionId,
    metadata: { typebot_expected_input_id: expectedInputId },
    last_message_at: new Date('2026-10-25T11:59:00.000Z').toISOString(),
    created_at: new Date('2026-10-25T11:50:00.000Z').toISOString(),
    updated_at: new Date('2026-10-25T11:59:00.000Z').toISOString()
  };
  // fakeClient.rows(table) devolve um array novo (não a referência interna)
  // quando a tabela nunca foi tocada por .from(table) — inicializa a tabela
  // de verdade antes de semear a linha, senão o push se perde.
  if (!fakeClient.tables.whatsapp_sessions) fakeClient.tables.whatsapp_sessions = [];
  fakeClient.tables.whatsapp_sessions.push(row);
  return row;
}

async function main() {
  const results = {};

  // ---- Cenário principal: turno anterior -> CEP localizado -> número/complemento ----
  {
    const identity = makeIdentity('5511999991001');
    seedSession({ id: 'wa-sess-cep-regression', phone: identity.phone, typebotSessionId: 'sess-cep-regression', expectedInputId: PREVIOUS_INPUT_ID });

    const { bridge, typebotCalls, sentTexts } = makeBridge({
      lookupCepResult: {
        logradouro: 'Rua Aurora', bairro: 'Santa Efigênia',
        cidade: 'São Paulo', estado: 'SP', cep: '01209003', encontrado: true
      },
      typebotScript: [
        // Turno 0 (input anterior -> Typebot pergunta o CEP de verdade):
        // é este retorno que precisa ser persistido como typebot_expected_input_id.
        async () => ({
          messages: [{ type: 'text', content: { plainText: 'Qual é o seu CEP?' } }],
          input: { id: CEP_INPUT_ID, type: 'text input' }
        }),
        // Turno 1 (patient envia o CEP): o cursor real do Typebot segue pelo
        // caminho "não localizado" por baixo dos panos (comportamento atual,
        // documentado no bridge) — o bridge é quem troca a mensagem/estado.
        async () => ({
          messages: [{ type: 'text', content: { plainText: 'Não foi possível localizar automaticamente o endereço. Informe seu endereço completo.' } }],
          input: { id: ENDERECO_INPUT_ID, type: 'text input' }
        }),
        // Turno 2 (patient envia número/complemento -> endereço completo vai
        // para o input real do Typebot):
        async () => ({
          messages: [{ type: 'text', content: { plainText: 'Obrigado! Prosseguindo...' } }],
          input: { id: 'proximo_input_pos_endereco', type: 'text input' }
        })
      ]
    });

    // Turno 0: paciente responde ao input anterior — Typebot avança e pede o CEP.
    await bridge({ messageId: 'turn-0', text: 'resposta ao input anterior', identity, whatsappSession: await getSessionByPhone(identity.phone) });

    const afterTurn0 = await getSessionByPhone(identity.phone);
    assert.equal(
      afterTurn0.metadata.typebot_expected_input_id,
      CEP_INPUT_ID,
      'turno 0: expected input persistido no store real deve ser blk_0oydu2f7 após o Typebot pedir o CEP'
    );
    results.turno0_expectedInputPersistidoComoBlkCep = 'ok';

    // Turno 1: paciente envia o CEP. reloadSession real (getSessionByPhone)
    // tem que ler blk_0oydu2f7 de volta para o lookupCep disparar.
    const sessionBeforeTurn1 = await getSessionByPhone(identity.phone);
    assert.equal(sessionBeforeTurn1.metadata.typebot_expected_input_id, CEP_INPUT_ID, 'pré-condição turno 1: sessão recarregada ainda aponta para blk_0oydu2f7');

    await bridge({ messageId: 'turn-1', text: '01209-003', identity, whatsappSession: sessionBeforeTurn1 });

    assert.equal(typebotCalls.length, 2, 'turno 1 chamou o Typebot (continueChat) depois do turno 0');
    assert.equal(typebotCalls[1].text, '01209003', 'CEP normalizado (8 dígitos) é enviado ao Typebot — prova que a validação reconheceu o input como CEP');
    assert.ok(/Localizamos o seguinte endereço/.test(sentTexts[sentTexts.length - 1]), 'lookupCep executou e a confirmação do endereço foi enviada ao paciente (não a mensagem "não localizado" do Typebot)');
    assert.ok(!/não foi possível localizar/i.test(sentTexts[sentTexts.length - 1]), 'mensagem "não localizado" do Typebot não vazou ao paciente');

    const afterTurn1 = await getSessionByPhone(identity.phone);
    assert.equal(afterTurn1.metadata.typebot_expected_input_id, SENTINEL, 'turno 1: próximo estado persistido é o marcador interno (número/complemento)');
    assert.deepEqual(afterTurn1.metadata.cep_lookup?.encontrado, true, 'turno 1: cep_lookup guardado na sessão real');
    results.turno1_lookupCepExecutouEArmouSentinela = 'ok';

    // Turno 2: paciente envia número/complemento -> endereço completo deve
    // ser enviado ao input REAL de endereço do Typebot (nunca ao CEP de novo).
    const sessionBeforeTurn2 = await getSessionByPhone(identity.phone);
    await bridge({ messageId: 'turn-2', text: '965, apto 2', identity, whatsappSession: sessionBeforeTurn2 });

    assert.equal(typebotCalls.length, 3, 'turno 2 chamou o Typebot novamente');
    assert.equal(
      typebotCalls[2].text,
      'Rua Aurora, 965 apto 2, Santa Efigênia, São Paulo, SP',
      'turno 2: endereço completo (5 segmentos) enviado ao input real de endereço'
    );

    const afterTurn2 = await getSessionByPhone(identity.phone);
    assert.equal(afterTurn2.metadata.cep_lookup, null, 'turno 2: cep_lookup limpo após consumir');
    assert.equal(afterTurn2.metadata.typebot_expected_input_id, 'proximo_input_pos_endereco', 'turno 2: fluxo segue normalmente após o endereço, sem reiniciar sessão nem abrir menu');
    assert.ok(afterTurn2.typebot_session_id, 'sessão Typebot não foi reiniciada em nenhum turno');
    results.turno2_enderecoCompletoEnviadoAoInputRealSemReiniciarSessao = 'ok';
  }

  // ---- CEP inválido continua sendo recusado (sem chamar o Typebot) ----
  {
    const identity = makeIdentity('5511999991002');
    seedSession({ id: 'wa-sess-cep-invalido', phone: identity.phone, typebotSessionId: 'sess-cep-invalido', expectedInputId: CEP_INPUT_ID });

    const { bridge, typebotCalls, sentTexts } = makeBridge({
      lookupCepResult: { encontrado: false },
      typebotScript: []
    });

    const session = await getSessionByPhone(identity.phone);
    await bridge({ messageId: 'turn-invalid', text: '123', identity, whatsappSession: session });

    assert.equal(typebotCalls.length, 0, 'CEP com formato inválido não chega a chamar o Typebot');
    assert.ok(/CEP válido/.test(sentTexts[0] || ''), 'paciente recebe a mensagem de validação, não o lookup');
    results.cepInvalido_continuaRecusado = 'ok';
  }

  // ---- CEP válido mas não localizado -> caminho manual inalterado ----
  {
    const identity = makeIdentity('5511999991003');
    seedSession({ id: 'wa-sess-cep-nao-localizado', phone: identity.phone, typebotSessionId: 'sess-cep-nao-localizado', expectedInputId: CEP_INPUT_ID });

    const { bridge, typebotCalls, sentTexts } = makeBridge({
      lookupCepResult: { encontrado: false },
      typebotScript: [
        async () => ({
          messages: [{ type: 'text', content: { plainText: 'Não foi possível localizar automaticamente o endereço. Informe seu endereço completo.' } }],
          input: { id: ENDERECO_INPUT_ID, type: 'text input' }
        })
      ]
    });

    const session = await getSessionByPhone(identity.phone);
    await bridge({ messageId: 'turn-not-found', text: '00000000', identity, whatsappSession: session });

    assert.equal(typebotCalls.length, 1);
    assert.ok(/não foi possível localizar/i.test(sentTexts[0]), 'CEP não localizado: mensagem original do Typebot passa direto (caminho manual)');
    const after = await getSessionByPhone(identity.phone);
    assert.equal(after.metadata.typebot_expected_input_id, ENDERECO_INPUT_ID, 'CEP não localizado: próximo input é o real (endereço manual), não o marcador');
    results.cepValidoNaoLocalizado_caminhoManualInalterado = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
  const falhas = Object.entries(results).filter(([, v]) => v !== 'ok');
  if (falhas.length) { console.error('FALHAS:', falhas); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
