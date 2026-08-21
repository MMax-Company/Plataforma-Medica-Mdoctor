/**
 * Correção isolada no Typebot oficial (doctor-prescreve-8rmljgu), pedida por
 * Dr. Max em 25/07/2026: o bloco "Set variable" que calcula
 * var_resumo_medicamentos (blk_resumo_set_medicamentos) foi encontrado
 * desanexado do grupo "Confirmação de dados" (wupo36l29a2x66rh0bwf5yex),
 * sozinho num grupo órfão sem nome ("Group #49", id d25g7nph4czr3mn7go4sazkf),
 * sem nenhuma edge de entrada ou saída.
 *
 * Diagnóstico: NÃO é resquício de refatoração — é regressão real. O bloco de
 * texto "Confira seus dados" (k0i76xzc7cs84de90o94oy9i), dentro do próprio
 * grupo "Confirmação de dados", ainda referencia {{resumo_medicamentos}} no
 * campo "🔟 Medicamentos:", mas nada mais define essa variável desde que o
 * bloco foi removido dali — todo paciente que passa pela confirmação de
 * dados vê esse campo vazio.
 *
 * Correção: move blk_resumo_set_medicamentos de volta para dentro de
 * "Confirmação de dados", na mesma posição que os outros blocos
 * "resumo_set_*" já ocupam (logo antes do texto que consome as variáveis) —
 * e remove o grupo órfão, que fica vazio. Nenhuma outra alteração: conteúdo
 * do bloco, edges, variáveis e demais grupos permanecem exatamente iguais.
 */
require('./load-dotenv');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const STAMP = '20260725-resumo-medicamentos-orfao';

const CONFIRM_GROUP_ID = 'wupo36l29a2x66rh0bwf5yex';
const ORPHAN_GROUP_ID = 'd25g7nph4czr3mn7go4sazkf';
const MED_BLOCK_ID = 'blk_resumo_set_medicamentos';
const ANCHOR_BLOCK_ID = 'blk_resumo_set_cpf_mascarado';
const TEXT_BLOCK_ID = 'k0i76xzc7cs84de90o94oy9i';

const report = { fixed: [], notes: [], assertions: [] };
function check(name, ok, detail) {
  report.assertions.push({ name, ok: Boolean(ok), detail: detail === undefined ? null : detail });
  if (!ok) throw new Error(`ASSERTION FALHOU: ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`);
}
function findGroup(t, id) { const g = t.groups.find((x) => x.id === id); if (!g) throw new Error('grupo não encontrado: ' + id); return g; }
function findBlock(g, id) { const b = g.blocks.find((x) => x.id === id); if (!b) throw new Error(`bloco não encontrado: ${id} em ${g.id}`); return b; }
function blockText(b) { return (b.content.richText || []).map((p) => (p.children || []).map((c) => c.text || '').join('')).join('\n'); }

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
  const totalBlocksBefore = t.groups.reduce((n, g) => n + g.blocks.length, 0);

  // =====================================================================
  // Pré-condições — confirmam o diagnóstico antes de mexer em qualquer coisa
  // =====================================================================
  const gOrphan = findGroup(t, ORPHAN_GROUP_ID);
  const gConfirm = findGroup(t, CONFIRM_GROUP_ID);
  check('grupo órfão tem exatamente 1 bloco', gOrphan.blocks.length === 1, gOrphan.blocks.map((b) => b.id));
  const medBlock = findBlock(gOrphan, MED_BLOCK_ID);
  check('bloco órfão é Set variable de var_resumo_medicamentos', medBlock.type === 'Set variable' && medBlock.options?.variableId === 'var_resumo_medicamentos');

  const relatedEdges = before.typebot.edges.filter((e) =>
    e.from?.groupId === ORPHAN_GROUP_ID || e.to?.groupId === ORPHAN_GROUP_ID ||
    e.from?.blockId === MED_BLOCK_ID || e.to?.blockId === MED_BLOCK_ID);
  check('grupo órfão não tem nenhuma edge de entrada/saída', relatedEdges.length === 0, relatedEdges);

  check('Confirmação de dados NÃO contém mais o bloco (confirma a regressão)',
    !gConfirm.blocks.some((b) => b.id === MED_BLOCK_ID));

  const textBlockBefore = findBlock(gConfirm, TEXT_BLOCK_ID);
  check('texto de confirmação ainda referencia {{resumo_medicamentos}}', blockText(textBlockBefore).includes('{{resumo_medicamentos}}'));

  const anchorIndex = gConfirm.blocks.findIndex((b) => b.id === ANCHOR_BLOCK_ID);
  check('bloco-âncora (cpf_mascarado) encontrado em Confirmação de dados', anchorIndex !== -1);

  // =====================================================================
  // Correção: move o bloco para dentro de "Confirmação de dados", logo após
  // o outro bloco "resumo_set_*" (mesmo agrupamento visual/lógico dos
  // blocos que preparam variáveis para o texto seguinte) e remove o grupo
  // órfão. Conteúdo do bloco (id, options, expressão) preservado exatamente.
  // =====================================================================
  t.groups = t.groups.filter((g) => g.id !== ORPHAN_GROUP_ID);
  const gConfirmPatched = findGroup(t, CONFIRM_GROUP_ID);
  const insertAt = gConfirmPatched.blocks.findIndex((b) => b.id === ANCHOR_BLOCK_ID) + 1;
  gConfirmPatched.blocks.splice(insertAt, 0, medBlock);
  report.fixed.push(`Movido ${MED_BLOCK_ID} de "Group #49" (órfão, removido) para "Confirmação de dados", posição ${insertAt} (logo após ${ANCHOR_BLOCK_ID}, antes de ${TEXT_BLOCK_ID}).`);

  // =====================================================================
  // Validações finais
  // =====================================================================
  check('grupo órfão removido', !t.groups.some((g) => g.id === ORPHAN_GROUP_ID));
  const gConfirmFinal = findGroup(t, CONFIRM_GROUP_ID);
  check('bloco presente em Confirmação de dados', gConfirmFinal.blocks.some((b) => b.id === MED_BLOCK_ID));
  const medIdx = gConfirmFinal.blocks.findIndex((b) => b.id === MED_BLOCK_ID);
  const textIdx = gConfirmFinal.blocks.findIndex((b) => b.id === TEXT_BLOCK_ID);
  check('bloco fica ANTES do texto que consome a variável', medIdx !== -1 && textIdx !== -1 && medIdx < textIdx);
  check('conteúdo do bloco preservado exatamente (deep equal ao original)',
    JSON.stringify(gConfirmFinal.blocks.find((b) => b.id === MED_BLOCK_ID)) === JSON.stringify(medBlock));

  const totalBlocksAfter = t.groups.reduce((n, g) => n + g.blocks.length, 0);
  check('nenhum bloco perdido ou duplicado (mesma contagem total)', totalBlocksAfter === totalBlocksBefore, { antes: totalBlocksBefore, depois: totalBlocksAfter });
  check('nenhuma edge foi tocada (mesma contagem)', t.edges.length === before.typebot.edges.length);

  const danglingAfter = findDangling(t);
  const newDangling = danglingAfter.filter((id) => !danglingBefore.includes(id));
  check('nenhuma edge nova quebrada', newDangling.length === 0, { preExistentes: danglingBefore, novas: newDangling });

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
  fs.writeFileSync(path.join(ROOT, `backups/typebot-patch-resumo-medicamentos-orfao-report-${STAMP}.json`), JSON.stringify(report, null, 2));

  console.log('\nOK — publicado.');
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
