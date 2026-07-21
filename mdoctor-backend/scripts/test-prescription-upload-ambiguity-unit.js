// Fase 2 pedido 3 — teste isolado (sem rede/banco) de que findPendingUploadContext
// nunca vincula mídia ao paciente errado: mais de um atendimento aguardando
// receita para o mesmo telefone é erro explícito, não uma escolha arbitrária.
const assert = require('assert');
const path = require('path');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const base = path.join(__dirname, '..', 'src', 'services', 'typebot-prescription-upload.service.js');
const resolveFrom = (p) => path.join(path.dirname(base), p);

const STATUS = { AWAITING_PRESCRIPTION_UPLOAD: 'awaiting_prescription_upload' };
let atendimentosFixture = [];

stub(resolveFrom('../db/tables'), {});
stub(resolveFrom('../db/persistence'), { dbQuery: async () => null });
stub(resolveFrom('../store/atendimentos.store'), {
  STATUS,
  listAtendimentos: async () => atendimentosFixture,
  getAtendimento: async (id) => atendimentosFixture.find((a) => a.id === id) || null
});
stub(resolveFrom('../store/whatsapp-sessions.store'), {
  upsertSessionIdentity: async () => {},
  getSessionByPhone: async () => null
});
stub(resolveFrom('../store/integration-logs.store'), { createIntegrationError: async () => {} });
stub(resolveFrom('./clinical-payload-normalizer.service'), {
  hasStoredPreviousPrescription: (clinical = {}) => Boolean(clinical.previous_prescription_url)
});
stub(resolveFrom('./prescription-upload.service'), { completeExternalPrescriptionUpload: async () => ({}) });
stub(resolveFrom('./prescription-upload-token.service'), { resolveTokenRecord: async () => null });
stub(resolveFrom('./providers/meta.provider'), { sendTextMessage: async () => ({}), downloadMedia: async () => ({}) });

delete require.cache[require.resolve(base)];
const uploadService = require(base);

async function main() {
  const results = {};

  // 1) Um único atendimento aguardando -> resolve normalmente.
  atendimentosFixture = [
    { id: 'at-1', paciente_telefone: '5511985485777', status: STATUS.AWAITING_PRESCRIPTION_UPLOAD, dados_clinicos: { prescription_upload_session: { token: 'tok-1', upload_url: 'https://painel.example/upload-receita/tok-1' } } }
  ];
  const single = await uploadService.findPendingUploadContext('5511985485777');
  assert.equal(single.atendimentoId, 'at-1');
  results.umAtendimentoResolveNormal = 'ok';

  // 2) Dois atendimentos aguardando para o MESMO telefone -> erro explícito,
  //    nunca um palpite de qual pertence à mídia recebida.
  atendimentosFixture = [
    { id: 'at-1', paciente_telefone: '5511985485777', status: STATUS.AWAITING_PRESCRIPTION_UPLOAD, dados_clinicos: { prescription_upload_session: { token: 'tok-1', upload_url: 'https://painel.example/upload-receita/tok-1' } } },
    { id: 'at-2', paciente_telefone: '5511985485777', status: STATUS.AWAITING_PRESCRIPTION_UPLOAD, dados_clinicos: { prescription_upload_session: { token: 'tok-2', upload_url: 'https://painel.example/upload-receita/tok-2' } } }
  ];
  await assert.rejects(
    uploadService.findPendingUploadContext('5511985485777'),
    (err) => err.code === 'WHATSAPP_UPLOAD_AMBIGUOUS_ATENDIMENTO' && err.atendimentoIds.length === 2
  );
  results.ambiguidadeNuncaAdivinha = 'ok';

  // 3) Atendimento de outro telefone não interfere.
  atendimentosFixture = [
    { id: 'at-9', paciente_telefone: '5511900000009', status: STATUS.AWAITING_PRESCRIPTION_UPLOAD, dados_clinicos: { prescription_upload_session: { token: 'tok-9', upload_url: 'https://painel.example/upload-receita/tok-9' } } }
  ];
  const none = await uploadService.findPendingUploadContext('5511985485777');
  assert.equal(none, null);
  results.telefoneDiferenteNaoVincula = 'ok';

  console.log(JSON.stringify(results));
}

main().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
