// Teste ponta a ponta CONTRA O BANCO REAL (staging) do roteamento
// pos-finalizacao de suporte. Usa telefones de teste dedicados, reproduz a
// precondicao real do bug (sessao presa em typebot_expected_input_id =
// WELCOME_CHOICE_INPUT_ID, exatamente como encontrado no telefone real
// *8724 via scripts/inspect-support-bug-sessions.js) e valida os dois
// caminhos: "1" encerra, "2" inicia nova avaliacao no Typebot.
require('dotenv').config();
const { initSupabase } = require('../src/config/supabase');
initSupabase();
const assert = require('assert');
const {
  createWhatsAppSupportEntry,
  finalizeSupportAttendance,
  resolveMetaInboundRouting,
  getPatientSupportContext,
  SUPPORT_SUB
} = require('../src/services/whatsapp-support.service');
const { upsertSessionMetadata, getSessionByPhone } = require('../src/store/whatsapp-sessions.store');
const { getAtendimento } = require('../src/store/atendimentos.store');

const WELCOME_CHOICE_INPUT_ID = 'sbjZWLJGVkHAkDqS4JQeGow';

async function stageStuckWelcomeSession(phone) {
  // Reproduz exatamente a condicao encontrada no telefone real *8724: uma
  // sessao com typebot_session_id preenchido e typebot_expected_input_id
  // apontando pro choice "Vamos comecar", como se o paciente tivesse
  // abandonado uma tentativa antiga de "1 - Iniciar atendimento".
  await upsertSessionMetadata({
    phone,
    metadataPatch: { typebot_expected_input_id: WELCOME_CHOICE_INPUT_ID }
  });
}

async function testCaminho2_IniciaAvaliacao() {
  const phone = '5511900001005';
  await stageStuckWelcomeSession(phone);

  const created = await createWhatsAppSupportEntry({ phone });
  assert.equal(created.duplicate, false);
  const atendimentoId = created.atendimento.id;

  await finalizeSupportAttendance(atendimentoId);

  const ctxAfterFinalize = await getPatientSupportContext(phone);
  assert.equal(ctxAfterFinalize.support_sub_status, SUPPORT_SUB.AWAITING_DECISION, 'ticket está aguardando decisão após finalizar');

  // Camada 1 da correção: finalizeSupportAttendance já limpa o marcador
  // travado sozinho, antes mesmo do paciente responder.
  const sessionAfterFinalize = await getSessionByPhone(phone);
  assert.equal(sessionAfterFinalize.metadata.typebot_expected_input_id, undefined, 'finalizeSupportAttendance já limpa o marcador travado do Typebot');

  // Camada 2 da correção (defesa em profundidade): mesmo se o marcador
  // ficar travado de novo por qualquer outro motivo (ex.: registro antigo
  // de antes desta correção, como o telefone real *8724 encontrado em
  // produção), o roteamento agora prioriza o estado do ticket de suporte
  // sobre esse artefato do Typebot.
  await stageStuckWelcomeSession(phone);
  const sessionRestaged = await getSessionByPhone(phone);
  assert.equal(sessionRestaged.metadata.typebot_expected_input_id, WELCOME_CHOICE_INPUT_ID, 'marcador travado re-simulado para testar a camada 2 da correção');

  const routing = await resolveMetaInboundRouting({ phone, text: '2' });

  assert.equal(routing.action, 'typebot_clean', `"2" pós-finalização deve iniciar nova avaliação no Typebot (action=typebot_clean), recebido: ${JSON.stringify(routing)}`);
  assert.notEqual(routing.reply, 'Você já está na fila de suporte. Aguarde o contato da equipe.', 'não pode reencaminhar para a fila de suporte');

  const atendimentoAfter = await getAtendimento(atendimentoId);
  assert.equal(atendimentoAfter.status, 'rejected', 'ticket de suporte é fechado (rejected) ao converter para avaliação');
  assert.equal(atendimentoAfter.dados_clinicos.support_sub_status, SUPPORT_SUB.CONVERTED);

  const ctxAfter = await getPatientSupportContext(phone);
  assert.equal(ctxAfter, null, 'paciente NÃO pode ser reenviado ao suporte: nenhum ticket aberto permanece após a conversão');

  console.log('OK: caminho "2" pós-finalização inicia nova avaliação médica no Typebot (typebot_clean), sem reabrir suporte');
}

async function testCaminho1_EncerraELimpaSessao() {
  const phone = '5511900001006';
  await stageStuckWelcomeSession(phone);

  const created = await createWhatsAppSupportEntry({ phone });
  const atendimentoId = created.atendimento.id;

  await finalizeSupportAttendance(atendimentoId);

  const sessionAfterFinalize = await getSessionByPhone(phone);
  assert.equal(sessionAfterFinalize.metadata.typebot_expected_input_id, undefined, 'finalizeSupportAttendance já limpa o marcador travado do Typebot');

  // Defesa em profundidade: re-simula o marcador travado (ex.: registro
  // antigo de antes desta correção) para confirmar que o roteamento ainda
  // prioriza corretamente o estado do ticket de suporte.
  await stageStuckWelcomeSession(phone);

  const routing = await resolveMetaInboundRouting({ phone, text: '1' });

  assert.equal(routing.action, 'reply');
  assert.equal(routing.reply, 'Atendimento encerrado. Obrigado pelo contato com o Doctor Prescreve! Até logo.', `"1" pós-finalização deve encerrar, recebido: ${JSON.stringify(routing)}`);
  assert.notEqual(routing.action, 'typebot_clean', '"1" pós-finalização NUNCA pode iniciar o Typebot');

  const atendimentoAfter = await getAtendimento(atendimentoId);
  assert.equal(atendimentoAfter.status, 'rejected');
  assert.equal(atendimentoAfter.dados_clinicos.support_sub_status, SUPPORT_SUB.CLOSED_PATIENT);

  const sessionAfter = await getSessionByPhone(phone);
  assert.equal(sessionAfter.metadata.typebot_expected_input_id, undefined, 'sessão do Typebot é limpa ao encerrar — marcador travado não pode sobreviver');
  assert.equal(sessionAfter.typebot_session_id, null, 'typebot_session_id é limpo ao encerrar');

  const ctxAfter = await getPatientSupportContext(phone);
  assert.equal(ctxAfter, null, 'paciente NÃO pode ser reenviado ao suporte: nenhum ticket aberto permanece após encerrar');

  // Reenvio de "2" depois do encerramento deve iniciar um NOVO ciclo normal
  // (menu principal ou novo ticket), nunca reabrir o ticket já finalizado.
  const routingAfterClose = await resolveMetaInboundRouting({ phone, text: '2' });
  assert.equal(routingAfterClose.action, 'reply');
  assert.equal(routingAfterClose.reply, 'Seu atendimento foi encaminhado para o suporte.\n\nAguarde. Nossa equipe responderá assim que possível.\n\nPara encerrar o suporte, envie 0 ou ENCERRAR.', 'depois de encerrado, "2" abre um ticket NOVO (não reaproveita o antigo)');
  const newCtx = await getPatientSupportContext(phone);
  assert.notEqual(newCtx.atendimento_id, atendimentoId, 'o novo ticket é diferente do já finalizado');

  console.log('OK: caminho "1" pós-finalização encerra e limpa a sessão; suporte antigo não é reaberto');
}

async function main() {
  await testCaminho2_IniciaAvaliacao();
  await testCaminho1_EncerraELimpaSessao();
  console.log('TODOS OS TESTES PASSARAM');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FALHOU:', err.message, err.stack);
    process.exit(1);
  });
