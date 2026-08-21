/**
 * Correção restrita ao Typebot oficial (doctor-prescreve-8rmljgu), Fase 1 —
 * segundo pedido, autorizado por Dr. Max em 20/07/2026.
 *
 * IMPORTANTE: entre o levantamento original (18/07) e esta execução
 * (20/07), o Typebot já foi alterado por outro pedido ("primeiro pedido da
 * Fase 1"): o grupo de resumo foi reescrito (sem mais listar campo a campo)
 * e TODO o subsistema de idade (var_idade_paciente, var_idade_divergente,
 * blk_flag_idade_divergente, blk_check_idade, blk_calc_idade_nascimento,
 * grp_route_idade, grp_end_idade) já não existe mais — confirmado por GET
 * fresco antes de qualquer escrita. Este script portanto:
 *
 * 1) Faz snapshot completo (GET) imediatamente antes de qualquer alteração.
 * 2) CONFIRMA (sem re-remover) que a linha "Idade: {{idade_paciente}}" e os
 *    5 elementos órfãos + suas 2 edges exclusivas já não existem. Se algum
 *    deles ainda existir, o script os remove (idempotente); se já estiverem
 *    ausentes, apenas registra a confirmação — nada é re-executado.
 * 3) NÃO recria blk_calc_idade_nascimento (não fazia parte do pedido —
 *    apenas preservá-lo SE existisse; como já não existe, isso é reportado
 *    como divergência para o Dr. Max avaliar, sem decisão automática).
 * 4) Corrige placeholder + insere pergunta de texto (quando ausente) para
 *    os 7 campos de Dados pessoais: nome completo, nascimento, CPF,
 *    WhatsApp, e-mail, CEP, endereço.
 * 5) Garante que o endereço não peça CEP novamente nem misture CEP e
 *    endereço na mesma variável.
 *
 * Não altera medicamentos, receita anterior, tempo de uso, sinais de
 * alerta, telemedicina, declaração de elegibilidade, pagamento, upload,
 * suporte, ordem geral do fluxo, Backend, n8n, Meta, Stripe, painel ou
 * Memed.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const STAMP = '20260720-idade-placeholders';

const GRP_RESUMO = 'wupo36l29a2x66rh0bwf5yex';
const GRP_DADOS = 'od03hfeq73l5xvs0lj9xrox3';
const BLK_FLAG_IDADE_DIVERGENTE = 'blk_flag_idade_divergente';
const BLK_CHECK_IDADE = 'blk_check_idade';
const BLK_CALC_IDADE_NASCIMENTO = 'blk_calc_idade_nascimento';
const GRP_ROUTE_IDADE = 'grp_route_idade';
const GRP_END_IDADE = 'grp_end_idade';
const EDGE_ROUTE_IDADE_DEFAULT = 'whhjc7rr0vzetkkpuxlgr57d';
const EDGE_IDADE_BLOCK = 'edge_idade_block';
const VAR_IDADE_PACIENTE_NAME = 'idade_paciente';
const VAR_IDADE_DIVERGENTE_NAME = 'idade_divergente';

const FIELDS = [
  { label: 'nome completo', inputId: 'ds9z9lnz3yayokyy8d81fudj', questionBlockId: 'blk_pergunta_nome', question: 'Qual é o seu nome completo?', placeholder: 'Nome completo' },
  { label: 'data de nascimento', inputId: 'ar8jtu7sa8gfndqeebrvyj15', questionBlockId: 'blk_pergunta_nascimento', question: 'Qual é a sua data de nascimento?', placeholder: 'DD/MM/AAAA' },
  { label: 'cpf', inputId: 'dein7u2qnr8q32p2lv1krd5p', questionBlockId: 'blk_pergunta_cpf', question: 'Qual é o seu CPF?', placeholder: '00000000000' },
  { label: 'whatsapp', inputId: 'tbla9w2i2kbeyzun88hai3s9', questionBlockId: 'blk_pergunta_whatsapp', question: 'Qual é o seu número de WhatsApp com DDD?', placeholder: '11999999999' },
  { label: 'email', inputId: 'dwoaqosurlamebpra9yf7pm4', questionBlockId: 'blk_pergunta_email', question: 'Qual é o seu e-mail?', placeholder: 'nome@dominio.com' },
  { label: 'cep', inputId: 'blk_0oydu2f7', questionBlockId: 'blk_pergunta_cep', question: 'Qual é o seu CEP?', placeholder: '00000000' },
  { label: 'endereço', inputId: 'q78qjnk6ticwkeifl7xe2rju', questionBlockId: 'blk_pergunta_endereco', question: 'Qual é o seu endereço?', placeholder: 'Rua, número e bairro' }
];

function makeQuestionBlock(id, text) {
  return { id, type: 'text', content: { richText: [{ id: `${id}_p`, type: 'p', children: [{ text }] }] } };
}

const report = { alreadyDone: [], changed: [], assertions: [] };
function check(name, ok, detail) {
  report.assertions.push({ name, ok: Boolean(ok), detail: detail || null });
  if (!ok) throw new Error(`ASSERTION FALHOU: ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const token = process.env.TYPEBOT_TOKEN || process.env.TYPEBOT_API_TOKEN;
  if (!token) throw new Error('TYPEBOT_TOKEN ou TYPEBOT_API_TOKEN ausente');
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  // ---- 1) Snapshot ANTES ----
  const g0 = await fetch(`https://app.typebot.com/api/v1/typebots/${TYPEBOT_ID}`, { headers: H });
  console.log('GET antes HTTP', g0.status);
  if (g0.status !== 200) throw new Error(await g0.text());
  const before = await g0.json();
  const beforePath = path.join(ROOT, `backups/typebot-doctor-prescreve-antes-${STAMP}.json`);
  fs.writeFileSync(beforePath, JSON.stringify(before, null, 2));
  console.log('snapshot antes salvo em', beforePath);

  const t = JSON.parse(JSON.stringify(before.typebot));
  const groupsBefore = t.groups.length;
  const edgesBefore = t.edges.length;
  const varsBefore = t.variables.length;

  // ---- 2) Resumo: linha de idade ----
  const grpResumo = t.groups.find((g) => g.id === GRP_RESUMO);
  check('grupo de resumo existe', Boolean(grpResumo));
  const resumoStr = JSON.stringify(grpResumo);
  if (/idade_paciente/i.test(resumoStr)) {
    for (const b of grpResumo.blocks) {
      if (b.content?.richText) {
        const filtered = b.content.richText.filter((p) => !/idade_paciente/i.test(JSON.stringify(p)));
        if (filtered.length !== b.content.richText.length) {
          b.content.richText = filtered;
          report.changed.push(`resumo: linha "Idade: {{idade_paciente}}" removida do bloco ${b.id}`);
        }
      }
    }
  } else {
    report.alreadyDone.push('Linha "Idade: {{idade_paciente}}" já não existe no resumo (removida em pedido anterior)');
  }
  check('resumo sem idade_paciente após este passo', !/idade_paciente/i.test(JSON.stringify(t.groups.find((g) => g.id === GRP_RESUMO))));

  // ---- 2b) Elementos órfãos: idempotente ----
  const hasVarPaciente = t.variables.some((v) => v.name === VAR_IDADE_PACIENTE_NAME);
  const hasVarDivergente = t.variables.some((v) => v.name === VAR_IDADE_DIVERGENTE_NAME);
  if (hasVarPaciente || hasVarDivergente) {
    t.variables = t.variables.filter((v) => v.name !== VAR_IDADE_PACIENTE_NAME && v.name !== VAR_IDADE_DIVERGENTE_NAME);
    report.changed.push('variáveis idade_paciente/idade_divergente removidas');
  } else {
    report.alreadyDone.push('Variáveis idade_paciente e idade_divergente já não existem (removidas em pedido anterior)');
  }

  const grpDados = t.groups.find((g) => g.id === GRP_DADOS);
  check('grupo Dados Pessoais existe', Boolean(grpDados));
  if (grpDados.blocks.some((b) => b.id === BLK_FLAG_IDADE_DIVERGENTE)) {
    grpDados.blocks = grpDados.blocks.filter((b) => b.id !== BLK_FLAG_IDADE_DIVERGENTE);
    report.changed.push('blk_flag_idade_divergente removido');
  } else {
    report.alreadyDone.push('blk_flag_idade_divergente já não existe (removido em pedido anterior)');
  }

  const hasRouteIdade = t.groups.some((g) => g.id === GRP_ROUTE_IDADE);
  const hasEndIdade = t.groups.some((g) => g.id === GRP_END_IDADE);
  if (hasRouteIdade || hasEndIdade) {
    t.groups = t.groups.filter((g) => g.id !== GRP_ROUTE_IDADE && g.id !== GRP_END_IDADE);
    report.changed.push('grp_route_idade e/ou grp_end_idade removidos');
  } else {
    report.alreadyDone.push('grp_route_idade e grp_end_idade já não existem (removidos em pedido anterior)');
  }

  const hasEdgeRoute = t.edges.some((e) => e.id === EDGE_ROUTE_IDADE_DEFAULT);
  const hasEdgeBlock = t.edges.some((e) => e.id === EDGE_IDADE_BLOCK);
  if (hasEdgeRoute || hasEdgeBlock) {
    t.edges = t.edges.filter((e) => e.id !== EDGE_ROUTE_IDADE_DEFAULT && e.id !== EDGE_IDADE_BLOCK);
    report.changed.push('edges whhjc7rr0vzetkkpuxlgr57d e/ou edge_idade_block removidas');
  } else {
    report.alreadyDone.push('As 2 edges exclusivas do subsistema de idade já não existem (removidas em pedido anterior)');
  }

  const calcIdadeExists = t.groups.some((g) => g.blocks.some((b) => b.id === BLK_CALC_IDADE_NASCIMENTO));
  const checkIdadeExists = t.groups.some((g) => g.blocks.some((b) => b.id === BLK_CHECK_IDADE));
  report.blkCalcIdadeNascimentoStatus = calcIdadeExists
    ? 'presente e preservado (nenhuma ação tomada)'
    : 'AUSENTE — já não existia no GET feito antes desta execução; não foi removido por este script (não fazia parte do pedido 2, apenas preservá-lo caso existisse). Divergência a confirmar com Dr. Max.';
  report.blkCheckIdadeStatus = checkIdadeExists ? 'ainda presente (fora de escopo, não tocado)' : 'já não existia (fora de escopo, não tocado)';

  // ---- Assertions pós-limpeza de idade ----
  check('idade_paciente não aparece em nenhuma variável', !t.variables.some((v) => v.name === VAR_IDADE_PACIENTE_NAME));
  check('idade_divergente não aparece em nenhuma variável', !t.variables.some((v) => v.name === VAR_IDADE_DIVERGENTE_NAME));
  check('blk_flag_idade_divergente removido/ausente', !t.groups.some((g) => g.blocks.some((b) => b.id === BLK_FLAG_IDADE_DIVERGENTE)));
  check('grp_route_idade removido/ausente', !t.groups.some((g) => g.id === GRP_ROUTE_IDADE));
  check('grp_end_idade removido/ausente', !t.groups.some((g) => g.id === GRP_END_IDADE));
  check('edge whhjc7rr0vzetkkpuxlgr57d removida/ausente', !t.edges.some((e) => e.id === EDGE_ROUTE_IDADE_DEFAULT));
  check('edge_idade_block removida/ausente', !t.edges.some((e) => e.id === EDGE_IDADE_BLOCK));

  // ---- 3) Placeholders + perguntas dos 7 campos ----
  for (const field of FIELDS) {
    const grp = t.groups.find((g) => g.blocks.some((b) => b.id === field.inputId));
    check(`grupo do campo ${field.label} encontrado`, Boolean(grp), field.inputId);
    const idx = grp.blocks.findIndex((b) => b.id === field.inputId);
    const inputBlock = grp.blocks[idx];
    check(`options.labels presente em ${field.label}`, Boolean(inputBlock.options && inputBlock.options.labels));

    const oldPlaceholder = inputBlock.options.labels.placeholder;
    inputBlock.options.labels.placeholder = field.placeholder;
    if (oldPlaceholder !== field.placeholder) {
      report.changed.push(`placeholder de "${field.label}" (${field.inputId}): "${oldPlaceholder}" -> "${field.placeholder}"`);
    }

    const hasOwnQuestion = grp.blocks.some((b) => b.id === field.questionBlockId);
    if (!hasOwnQuestion) {
      const freshIdx = grp.blocks.findIndex((b) => b.id === field.inputId);
      grp.blocks.splice(freshIdx, 0, makeQuestionBlock(field.questionBlockId, field.question));
      report.changed.push(`pergunta de texto inserida antes de "${field.label}": "${field.question}" (bloco ${field.questionBlockId})`);
    } else {
      report.alreadyDone.push(`pergunta de "${field.label}" já existia (bloco ${field.questionBlockId})`);
    }
  }

  // ---- Assertions dos 7 campos ----
  const grpDadosFinal = t.groups.find((g) => g.id === GRP_DADOS);
  for (const field of FIELDS) {
    const inputBlock = grpDadosFinal.blocks.find((b) => b.id === field.inputId);
    const questionBlock = grpDadosFinal.blocks.find((b) => b.id === field.questionBlockId);
    check(`placeholder de "${field.label}" correto`, inputBlock.options.labels.placeholder === field.placeholder, inputBlock.options.labels.placeholder);
    check(`pergunta de "${field.label}" presente e completa`, Boolean(questionBlock), 'ausente');
    const qText = questionBlock.content.richText.map((p) => (p.children || []).map((c) => c.text || '').join('')).join('');
    check(`texto da pergunta de "${field.label}" correto`, qText === field.question, qText);
    const qIdx = grpDadosFinal.blocks.findIndex((b) => b.id === field.questionBlockId);
    const iIdx = grpDadosFinal.blocks.findIndex((b) => b.id === field.inputId);
    check(`pergunta de "${field.label}" está imediatamente antes do input`, qIdx === iIdx - 1);
  }

  // ---- CEP / Endereço ----
  const cepQuestion = grpDadosFinal.blocks.find((b) => b.id === 'blk_pergunta_cep');
  const cepInput = grpDadosFinal.blocks.find((b) => b.id === 'blk_0oydu2f7');
  const enderecoQuestion = grpDadosFinal.blocks.find((b) => b.id === 'blk_pergunta_endereco');
  const enderecoInput = grpDadosFinal.blocks.find((b) => b.id === 'q78qjnk6ticwkeifl7xe2rju');
  check('CEP só é perguntado no bloco dedicado (pergunta + input)', !/\bCEP\b/i.test(JSON.stringify(enderecoQuestion)) && !/\bCEP\b/i.test(JSON.stringify(enderecoInput)));
  check('endereço não usa "Endereço com CEP"', !/Endereço com CEP/i.test(JSON.stringify(enderecoInput)));
  check('CEP e endereço permanecem em variáveis distintas', cepInput.options.variableId !== enderecoInput.options.variableId, `${cepInput.options.variableId} vs ${enderecoInput.options.variableId}`);
  check('placeholder do endereço é o oficial', enderecoInput.options.labels.placeholder === 'Rua, número e bairro');

  // ---- Integridade estrutural (edges/blocos não quebrados) ----
  // Checa REGRESSÃO, não o estado geral do bot: já existem 3 edges órfãs
  // pré-existentes (gxvgai6wl7iwwc41d6lrrx6z, fu2odekdi7zmcs9na14bkaks,
  // oeuocbgqpa3fmza0z9jrorm5 — apontam de blocos que não existem mais desde
  // o pedido 1, fora do escopo desta correção) para grupos válidos
  // (Declaração de elegibilidade / Group #23). Corrigi-las está fora do
  // escopo autorizado ("não alterar ordem geral do fluxo" / demais telas
  // não listadas). Este check garante apenas que NENHUMA NOVA edge quebrada
  // foi introduzida pelas alterações deste script.
  function findDangling(bot) {
    const blockIds = new Set();
    bot.groups.forEach((g) => g.blocks.forEach((b) => blockIds.add(b.id)));
    const groupIds = new Set(bot.groups.map((g) => g.id));
    return bot.edges
      .filter((e) => {
        const fromOk = e.from.blockId ? blockIds.has(e.from.blockId) : true;
        const toOk = (e.to.groupId ? groupIds.has(e.to.groupId) : true) && (e.to.blockId ? blockIds.has(e.to.blockId) : true);
        return !fromOk || !toOk;
      })
      .map((e) => e.id);
  }
  const danglingBefore = new Set(findDangling(before.typebot));
  const danglingAfter = findDangling(t);
  const newDangling = danglingAfter.filter((id) => !danglingBefore.has(id));
  check('nenhuma NOVA edge quebrada foi introduzida por esta correção', newDangling.length === 0, JSON.stringify({ preExistentes: [...danglingBefore], novas: newDangling }));
  if (danglingBefore.size > 0) {
    report.preExistingDanglingEdges = [...danglingBefore];
  }

  // fora do escopo: nenhum outro grupo/edge/variável deve ter sido tocado
  check('nenhum grupo extra foi removido (só grp_route_idade/grp_end_idade, se existentes)', t.groups.length >= groupsBefore - 2);
  check('nenhuma edge extra foi removida (só as 2 de idade, se existentes)', t.edges.length >= edgesBefore - 2);
  check('nenhuma variável extra foi removida (só as 2 de idade, se existentes)', t.variables.length >= varsBefore - 2);

  console.log('\n=== RESUMO PRÉ-PUBLICAÇÃO ===');
  console.log('Já estava feito (nenhuma ação):');
  report.alreadyDone.forEach((x) => console.log(' -', x));
  console.log('Alterado agora:');
  report.changed.forEach((x) => console.log(' -', x));
  console.log('Assertions:', report.assertions.filter((a) => a.ok).length, '/', report.assertions.length, 'OK');

  // ---- Publicação (só chega aqui se TODAS as assertions passaram) ----
  const patch = await fetch(`https://app.typebot.com/api/v1/typebots/${TYPEBOT_ID}`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({ typebot: { version: t.version, groups: t.groups, edges: t.edges, variables: t.variables }, overwrite: true })
  });
  console.log('PATCH HTTP', patch.status);
  if (patch.status !== 200) { console.log((await patch.text()).slice(0, 1500)); process.exit(1); }

  const pub = await fetch(`https://app.typebot.com/api/v1/typebots/${TYPEBOT_ID}/publish`, { method: 'POST', headers: H });
  console.log('PUBLISH HTTP', pub.status);
  if (pub.status !== 200) { console.log((await pub.text()).slice(0, 1500)); process.exit(1); }

  const g1 = await fetch(`https://app.typebot.com/api/v1/typebots/${TYPEBOT_ID}`, { headers: H });
  console.log('GET depois HTTP', g1.status);
  const after = await g1.json();
  const afterPath = path.join(ROOT, `backups/typebot-doctor-prescreve-depois-${STAMP}.json`);
  fs.writeFileSync(afterPath, JSON.stringify(after, null, 2));
  console.log('snapshot depois salvo em', afterPath);

  fs.writeFileSync(
    path.join(ROOT, `backups/typebot-patch12-report-${STAMP}.json`),
    JSON.stringify({ ...report, groupsBefore, edgesBefore, varsBefore, groupsAfter: t.groups.length, edgesAfter: t.edges.length, varsAfter: t.variables.length }, null, 2)
  );

  console.log('\nOK — publicado.');
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
