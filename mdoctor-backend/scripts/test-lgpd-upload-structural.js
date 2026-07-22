/**
 * Correção estrutural: LGPD não pode acionar upload; contexto só por pending válido.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  UPLOAD_CHOICE_INPUT_IDS,
  augmentOutputsWithUploadLink,
  responseLooksLikeUploadStage
} = require('../src/services/typebot-prescription-upload.service');
const { convertTypebotResponse } = require('../src/services/typebot-whatsapp.bridge');
const { STATUS } = require('../src/store/atendimentos.store');
const { hasStoredPreviousPrescription } = require('../src/services/clinical-payload-normalizer.service');

function buildLgpdTypebotFromExport() {
  const bot = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-staging-safe.json'),
      'utf8'
    )
  );
  const group = bot.groups.find((g) => /LGPD|Consentimento/i.test(g.title || ''));
  assert.ok(group, 'grupo Consentimento LGPD deve existir no export');
  const texts = group.blocks.filter((b) => b.type === 'text');
  const choice = group.blocks.find((b) => b.type === 'choice input');
  assert.ok(choice, 'choice Autorizo/Não autorizo deve existir');
  return {
    messages: texts.map((b) => ({ type: 'text', content: b.content })),
    input: choice
  };
}

/** Espelha o critério de sessão de findPendingUploadContext (sem I/O). */
function sessionPathWouldReturnContext(atendimento) {
  if (!atendimento) return false;
  const clinical = atendimento.dados_clinicos || {};
  const hasSession = Boolean(clinical.prescription_upload_session?.token);
  const awaiting =
    String(atendimento.status || '').toLowerCase() === STATUS.AWAITING_PRESCRIPTION_UPLOAD ||
    clinical.prescription_upload_pending === true;
  return hasSession && awaiting && !hasStoredPreviousPrescription(clinical);
}

function main() {
  const serviceSrc = fs.readFileSync(
    path.join(__dirname, '../src/services/typebot-prescription-upload.service.js'),
    'utf8'
  );
  const looksBody = serviceSrc.match(/function responseLooksLikeUploadStage[\s\S]*?\n\}/)[0];
  const findBody = serviceSrc.match(/async function findUploadContextForPhone[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(looksBody, /receita\|upload\|enviar foto/);
  assert.match(looksBody, /isUploadChoiceInput/);
  assert.doesNotMatch(findBody, /listAtendimentos/);
  assert.match(findBody, /return findPendingUploadContext/);

  // 1) LGPD com “receita digital” + contexto antigo → botões, sem hint de upload
  const lgpd = buildLgpdTypebotFromExport();
  const lgpdBlob = JSON.stringify(lgpd.messages || []);
  assert.match(lgpdBlob, /receita/i, 'pré-condição: LGPD menciona receita');
  assert.match(lgpdBlob, /https?:\/\//i, 'pré-condição: LGPD tem links https');

  assert.equal(responseLooksLikeUploadStage(lgpd, lgpd.input.id), false);
  assert.equal(responseLooksLikeUploadStage(lgpd, null), false);

  const outputs = convertTypebotResponse(lgpd);
  assert.ok(outputs.some((o) => o.kind === 'buttons'));
  assert.ok(
    outputs.some(
      (o) =>
        o.kind === 'buttons' &&
        (o.choices || []).some((c) => /Autorizo/i.test(String(c.title || c.content || c.value || '')))
    )
  );
  assert.ok(
    outputs.some(
      (o) =>
        o.kind === 'buttons' &&
        (o.choices || []).some((c) => /Não autorizo|Nao autorizo/i.test(String(c.title || c.content || c.value || '')))
    )
  );

  const oldCtx = {
    atendimentoId: 'at-old-delivered',
    token: 'tok-old',
    uploadUrl: 'https://example.com/upload-receita/tok-old'
  };
  // Bridge só chama augment se looksLike && context — looksLike=false.
  const maybeAugmented = responseLooksLikeUploadStage(lgpd, lgpd.input.id)
    ? augmentOutputsWithUploadLink(outputs, oldCtx)
    : outputs;
  assert.equal(
    maybeAugmented.some((o) => /Envie agora uma foto legível/i.test(String(o.text || ''))),
    false
  );
  assert.ok(maybeAugmented.some((o) => o.kind === 'buttons'));

  // 2) Atendimento antigo entregue → findUploadContextForPhone / pending path → null
  const delivered = {
    id: 'at-old-delivered',
    status: 'delivered',
    paciente_telefone: '5511999000001',
    dados_clinicos: {
      prescription_upload_session: { token: 'tok-old', status: 'completed' },
      foto_receita_url: 'https://example.com/receita.jpg',
      previous_prescription_file: 'https://example.com/receita.jpg'
    }
  };
  assert.equal(sessionPathWouldReturnContext(delivered), false);
  assert.equal(hasStoredPreviousPrescription(delivered.dados_clinicos), true);
  // findUploadContextForPhone só delega a findPendingUploadContext (sem list amplo).
  assert.match(findBody, /findPendingUploadContext/);
  assert.doesNotMatch(findBody, /listAtendimentos/);

  // 3) Etapa real de upload pelos IDs oficiais
  for (const id of UPLOAD_CHOICE_INPUT_IDS) {
    assert.equal(responseLooksLikeUploadStage({ input: { id } }, null), true);
    assert.equal(responseLooksLikeUploadStage({ messages: [{ type: 'text', content: 'x' }] }, id), true);
  }
  const uploadTypebot = {
    messages: [
      {
        type: 'text',
        content: {
          richText: [
            {
              type: 'p',
              children: [{ text: 'Use novamente o link abaixo e depois clique em "Conferir novamente".' }]
            },
            {
              type: 'p',
              children: [
                {
                  type: 'a',
                  url: 'https://painel.example/upload-receita/token-abc',
                  children: [{ text: 'Enviar foto da receita' }]
                }
              ]
            }
          ]
        }
      }
    ],
    input: {
      id: 'blk_upload_pending_choice',
      type: 'choice input',
      items: [{ content: 'Conferir novamente' }]
    }
  };
  assert.equal(responseLooksLikeUploadStage(uploadTypebot, 'blk_upload_pending_choice'), true);
  const uploadOutputs = convertTypebotResponse(uploadTypebot);
  const augmented = augmentOutputsWithUploadLink(uploadOutputs, {
    atendimentoId: 'at-1',
    token: 'token-abc',
    uploadUrl: 'https://painel.example/upload-receita/token-abc'
  });
  assert.ok(augmented.some((o) => /Envie agora uma foto legível|WhatsApp/i.test(String(o.text || ''))));
  assert.ok(!augmented.some((o) => /painel\.example\/upload-receita/i.test(String(o.text || ''))));

  // 4) Fluxo inicial: sem mensagem prematura de upload
  assert.equal(
    responseLooksLikeUploadStage({ messages: [{ type: 'text', content: 'Olá' }] }, 'sbjZWLJGVkHAkDqS4JQeGow'),
    false
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        lgpdDoesNotTriggerUpload: true,
        lgpdKeepsAutorizoButtons: true,
        deliveredOldAtendimentoReturnsNull: true,
        officialUploadIdsRecognized: [...UPLOAD_CHOICE_INPUT_IDS],
        uploadStripHintPreserved: true,
        initialFlowNoPrematureUpload: true
      },
      null,
      2
    )
  );
}

main();
