/**
 * Correção isolada no Typebot oficial (doctor-prescreve-8rmljgu), pedida
 * por Dr. Max em 24/07/2026 (com print de referência): a pergunta "Para
 * quais destas condições você faz tratamento contínuo?" (grupo "Doença
 * Cronica", vo62j813iek8fjy0uoq0ttrc) precisa permitir MÚLTIPLA seleção
 * (o bloco já é `choice input` com `isMultipleChoice: true` no Typebot,
 * mas o WhatsApp não tem seleção múltipla nativa em botões/lista — por
 * isso hoje a mensagem chega como uma lista de seleção ÚNICA, perdendo a
 * intenção original). O formato correto (confirmado pelo print) é texto
 * livre com números listados manualmente + resposta por números separados
 * por vírgula (ex.: "1,2"), exatamente como blk_resumo_set_condicoes já
 * espera (aceita `doenca_cronica` como lista separada por vírgula).
 *
 * Mudança: bloco b156nm008xh7gb52n7w3egzn deixa de ser `choice input` e
 * vira `text input` (mesmo variableId icaxqctv4r7b4du941d9qs46, mesma
 * outgoingEdgeId, sem alterar roteamento). A validação/conversão de
 * números ("1,2") para códigos ("has,dm") acontece no Backend
 * (typebot-clinical-data.validation.js, validateChronicConditions) antes
 * de enviar ao Typebot — mesmo padrão já usado para CEP/endereço.
 *
 * Não altera nenhuma outra pergunta, grupo, variável ou roteamento.
 */
require('./load-dotenv');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const STAMP = '20260724-doenca-cronica-multiselect';

const report = { fixed: [], notes: [], assertions: [] };
function check(name, ok, detail) {
  report.assertions.push({ name, ok: Boolean(ok), detail: detail === undefined ? null : detail });
  if (!ok) throw new Error(`ASSERTION FALHOU: ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`);
}
function findGroup(t, id) { const g = t.groups.find((x) => x.id === id); if (!g) throw new Error('grupo não encontrado: ' + id); return g; }
function findBlock(g, id) { const b = g.blocks.find((x) => x.id === id); if (!b) throw new Error(`bloco não encontrado: ${id} em ${g.id}`); return b; }
function blockText(b) { return (b.content.richText || []).map((p) => (p.children || []).map((c) => c.text || '').join('')).join('\n'); }
function p(id, text) { return { id, type: 'p', children: [{ text }] }; }

(async () => {
  const token = process.env.TYPEBOT_TOKEN || process.env.TYPEBOT_API_TOKEN;
  if (!token) throw new Error('TYPEBOT_TOKEN ou TYPEBOT_API_TOKEN ausente');
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  const g0 = await fetch(`https://app.typebot.com/api/v1/typebots/${TYPEBOT_ID}`, { headers: H });
  console.log('GET antes HTTP', g0.status);
  if (g0.status !== 200) throw new Error(await g0.text());
  const before = await g0.json();
  fs.writeFileSync(path.join(ROOT, `backups/typebot-doctor-prescreve-antes-${STAMP}.json`), JSON.stringify(before, null, 2));

  const t = JSON.parse(JSON.stringify(before.typebot));

  function findDangling(bot) {
    const blockIds = new Set(); bot.groups.forEach((g) => g.blocks.forEach((b) => blockIds.add(b.id)));
    const groupIds = new Set(bot.groups.map((g) => g.id));
    return bot.edges.filter((e) => {
      const fromOk = e.from.blockId ? blockIds.has(e.from.blockId) : true;
      const toOk = (e.to.groupId ? groupIds.has(e.to.groupId) : true) && (e.to.blockId ? blockIds.has(e.to.blockId) : true);
      return !fromOk || !toOk;
    }).map((e) => e.id);
  }
  const danglingBefore = findDangling(before.typebot);

  // =====================================================================
  // Pré-condições
  // =====================================================================
  const g = findGroup(t, 'vo62j813iek8fjy0uoq0ttrc');
  const blkTexto = findBlock(g, 'hda2dcvh33856qga899drcfi');
  const blkChoice = findBlock(g, 'b156nm008xh7gb52n7w3egzn');
  check('pré-condição: bloco ainda é choice input com isMultipleChoice:true', blkChoice.type === 'choice input' && blkChoice.options?.isMultipleChoice === true);
  check('pré-condição: variableId correto', blkChoice.options?.variableId === 'icaxqctv4r7b4du941d9qs46');
  check('pré-condição: outgoingEdgeId correto', blkChoice.outgoingEdgeId === 'edge_condicoes_to_route_check');
  check('pré-condição: 4 itens nas ordens/valores esperados', JSON.stringify(blkChoice.items.map((i) => [i.content, i.value])) === JSON.stringify([
    ['Hipertensão Arterial', 'has'], ['Diabetes Melitus', 'dm'], ['Dislipidemia', 'dlp'], ['Hipotireidismo', 'hipotireoidismo']
  ]));

  // =====================================================================
  // 1) Texto da pergunta: reformatado com lista numerada + instrução,
  //    igual ao print de referência.
  // =====================================================================
  blkTexto.content.richText = [
    p('p_condicoes_q', 'Para quais destas condições você faz tratamento contínuo?'),
    p('p_condicoes_b0', ''),
    p('p_condicoes_1', '1. Hipertensão Arterial'),
    p('p_condicoes_2', '2. Diabetes Melitus'),
    p('p_condicoes_3', '3. Dislipidemia'),
    p('p_condicoes_4', '4. Hipotireidismo'),
    p('p_condicoes_b1', ''),
    p('p_condicoes_instrucao', 'Digite os números correspondentes separados por vírgula (ex.: 1, 3). Pode escolher mais de uma opção.')
  ];
  report.fixed.push('hda2dcvh33856qga899drcfi: texto da pergunta reescrito com lista numerada (1-4) e instrução de resposta por números separados por vírgula, igual ao print de referência.');

  // =====================================================================
  // 2) Bloco vira text input (mesma variável, mesma edge) — validação e
  //    conversão número->código feita no Backend antes de enviar ao
  //    Typebot (validateChronicConditions em typebot-clinical-data
  //    .validation.js).
  // =====================================================================
  const idx = g.blocks.findIndex((b) => b.id === 'b156nm008xh7gb52n7w3egzn');
  g.blocks[idx] = {
    id: 'b156nm008xh7gb52n7w3egzn',
    outgoingEdgeId: 'edge_condicoes_to_route_check',
    type: 'text input',
    options: {
      variableId: 'icaxqctv4r7b4du941d9qs46',
      labels: { placeholder: 'Ex.: 1, 3', button: 'Enviar' }
    }
  };
  report.fixed.push('b156nm008xh7gb52n7w3egzn: convertido de choice input (isMultipleChoice, sem suporte real no WhatsApp) para text input — mesma variável (icaxqctv4r7b4du941d9qs46) e mesma edge de saída (edge_condicoes_to_route_check). Múltipla seleção agora funciona de fato: o paciente digita os números, o Backend valida e converte para os mesmos códigos (has,dm,dlp,hipotireoidismo) que blk_resumo_set_condicoes já espera.');

  // =====================================================================
  // VALIDAÇÕES FINAIS
  // =====================================================================
  const gAfter = t.groups.find((x) => x.id === 'vo62j813iek8fjy0uoq0ttrc');
  const blkChoiceAfter = gAfter.blocks.find((b) => b.id === 'b156nm008xh7gb52n7w3egzn');
  check('pós: bloco agora é text input', blkChoiceAfter.type === 'text input');
  check('pós: variableId preservado', blkChoiceAfter.options.variableId === 'icaxqctv4r7b4du941d9qs46');
  check('pós: outgoingEdgeId preservado', blkChoiceAfter.outgoingEdgeId === 'edge_condicoes_to_route_check');
  check('pós: texto contém as 4 condições numeradas e a instrução', (() => {
    const txt = blockText(gAfter.blocks.find((b) => b.id === 'hda2dcvh33856qga899drcfi'));
    return /1\. Hipertensão Arterial/.test(txt) && /2\. Diabetes Melitus/.test(txt) && /3\. Dislipidemia/.test(txt) && /4\. Hipotireidismo/.test(txt) && /separados por vírgula/.test(txt);
  })());

  const danglingAfter = findDangling(t);
  const newDangling = danglingAfter.filter((id) => !danglingBefore.includes(id));
  check('V. nenhuma edge nova quebrada', newDangling.length === 0, { preExistentes: danglingBefore, novas: newDangling });

  console.log('\n=== CORRIGIDO ===');
  report.fixed.forEach((x) => console.log(' -', x));
  console.log('Assertions:', report.assertions.filter((a) => a.ok === true).length, '/', report.assertions.length, 'OK');

  const patch = await fetch(`https://app.typebot.com/api/v1/typebots/${TYPEBOT_ID}`, {
    method: 'PATCH', headers: H,
    body: JSON.stringify({ typebot: { version: t.version, groups: t.groups, edges: t.edges, variables: t.variables }, overwrite: true })
  });
  console.log('PATCH HTTP', patch.status);
  if (patch.status !== 200) { console.log((await patch.text()).slice(0, 2000)); process.exit(1); }

  const pub = await fetch(`https://app.typebot.com/api/v1/typebots/${TYPEBOT_ID}/publish`, { method: 'POST', headers: H });
  console.log('PUBLISH HTTP', pub.status);
  if (pub.status !== 200) { console.log((await pub.text()).slice(0, 2000)); process.exit(1); }

  const g1 = await fetch(`https://app.typebot.com/api/v1/typebots/${TYPEBOT_ID}`, { headers: H });
  console.log('GET depois HTTP', g1.status);
  const after = await g1.json();
  fs.writeFileSync(path.join(ROOT, `backups/typebot-doctor-prescreve-depois-${STAMP}.json`), JSON.stringify(after, null, 2));
  fs.writeFileSync(path.join(ROOT, `backups/typebot-patch-doenca-cronica-multiselect-report-${STAMP}.json`), JSON.stringify(report, null, 2));

  console.log('\nOK — publicado.');
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
