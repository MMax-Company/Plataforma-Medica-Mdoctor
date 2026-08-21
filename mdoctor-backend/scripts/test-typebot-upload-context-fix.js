// Testes da correção do incidente 2026-07-21 (parte 2): botão da saudação
// inicial removido silenciosamente por causa de contexto de upload obsoleto.
// Cobre os dois pontos corrigidos:
//   1) findUploadContextForPhone() não pode mais devolver contexto de
//      atendimento antigo (entregue/rejeitado) só porque o telefone coincide.
//   2) responseLooksLikeUploadStage() não pode mais reagir a texto comum
//      (ex.: a palavra "receita" na saudação) — só a IDs estruturais.
// Usa o banco real de staging (telefone de teste isolado) para o ponto 1,
// já que a lógica depende de status real de atendimentos.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const assert = require('assert');

require('../src/config/supabase').initSupabase();
const { createClient } = require('@supabase/supabase-js');
const {
  STATUS,
  createAtendimento,
  updateAtendimentoStatus,
  getAtendimento
} = require('../src/store/atendimentos.store');
const {
  findUploadContextForPhone,
  responseLooksLikeUploadStage,
  UPLOAD_CHOICE_INPUT_IDS
} = require('../src/services/typebot-prescription-upload.service');

const TEST_PHONE = '5511900000997'; // número fake, isolado, não usado em produção

async function main() {
  const results = {};

  // ---- Parte 1: findUploadContextForPhone (banco real) ----

  const atendimento = await createAtendimento({
    paciente_nome: 'Teste Upload Context',
    paciente_telefone: TEST_PHONE,
    paciente_cpf: '00000000000',
    paciente_email: '',
    condicao: 'has',
    medicacao_em_uso: 'losartana',
    origem: 'whatsapp',
    status: STATUS.AWAITING_PRESCRIPTION_UPLOAD,
    pagamento_status: 'CONFIRMADO',
    risco: 'BAIXO',
    elegibilidade: { eligible: true, reasonCode: 'eligible', riskLevel: 'BAIXO', protocolVersion: 'test-v1' },
    dados_clinicos: {
      prescription_upload_session: {
        token: 'test-upload-token-997',
        upload_url: 'https://example.com/upload-receita/test-upload-token-997'
      }
    }
  });

  // 1a) Atendimento realmente aguardando upload -> contexto retornado normalmente.
  const ctxWhilePending = await findUploadContextForPhone(TEST_PHONE);
  assert.ok(ctxWhilePending, 'atendimento aguardando upload deveria retornar contexto');
  assert.equal(ctxWhilePending.token, 'test-upload-token-997');
  assert.equal(ctxWhilePending.atendimentoId, atendimento.id);
  results.atendimentoAguardandoUploadRetornaContexto = 'ok';

  // 1b) Mesmo atendimento entregue (finalizado) -> NÃO pode mais ser reaproveitado.
  await updateAtendimentoStatus(atendimento.id, STATUS.DELIVERED, {});
  const delivered = await getAtendimento(atendimento.id);
  assert.equal(delivered.status, STATUS.DELIVERED, 'pré-condição: atendimento deveria estar entregue');
  const ctxAfterDelivery = await findUploadContextForPhone(TEST_PHONE);
  assert.equal(ctxAfterDelivery, null, 'atendimento entregue não pode mais fornecer uploadContext (era o bug)');
  results.atendimentoEntregueAntigoRetornaNull = 'ok';

  // ---- Parte 2: responseLooksLikeUploadStage (função pura, sem banco) ----

  // 2a) Saudação inicial contém a palavra "receita", mas o input não é de
  //     upload -> NÃO deveria mais ser detectado como etapa de upload.
  const welcomeResponse = {
    messages: [
      { type: 'image', content: {} },
      {
        type: 'text',
        content: {
          richText: [
            { type: 'p', children: [{ text: 'Olá! Aqui você pode solicitar avaliação para renovação de receita.' }] }
          ]
        }
      }
    ],
    input: { type: 'choice input', id: 'sbjZWLJGVkHAkDqS4JQeGow', items: [{ content: 'Vamos começar' }] }
  };
  assert.equal(
    responseLooksLikeUploadStage(welcomeResponse, welcomeResponse.input.id),
    false,
    '"receita" em texto comum não deveria acionar a etapa de upload'
  );
  results.saudacaoComReceitaNaoAcionaUpload = 'ok';

  // 2b) Etapa real de upload (input estrutural blk_upload_check) continua
  //     sendo detectada normalmente.
  for (const uploadInputId of UPLOAD_CHOICE_INPUT_IDS) {
    const uploadResponse = {
      messages: [{ type: 'text', content: { richText: [{ type: 'p', children: [{ text: 'Envie a foto da receita anterior.' }] }] } }],
      input: { type: 'text input', id: uploadInputId }
    };
    assert.equal(
      responseLooksLikeUploadStage(uploadResponse, uploadInputId),
      true,
      `input estrutural "${uploadInputId}" deveria continuar sendo detectado como etapa de upload`
    );
  }
  results.etapaRealDeUploadContinuaDetectadaPorId = 'ok';

  // limpeza do atendimento de teste (tenta nas duas tabelas possíveis)
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  await supabase.from('appointments').delete().eq('id', atendimento.id);
  await supabase.from('atendimentos').delete().eq('id', atendimento.id);

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message);
  process.exit(1);
});
