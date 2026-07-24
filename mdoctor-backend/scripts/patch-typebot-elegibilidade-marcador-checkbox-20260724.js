/**
 * Correção isolada no Typebot oficial (doctor-prescreve-8rmljgu), pedida
 * por Dr. Max em 24/07/2026 com print de referência: no bloco "Critérios
 * de elegibilidade" (iw6zqwf26frmqnp1csxiwlbm, grupo "Declaração de
 * elegibilidade"), troca o marcador de cada critério de emoji numerado
 * (1️⃣-8️⃣) para ✅ (checkbox), igual ao print. Estrutura de 1 caixa de
 * texto + 1 caixa de botões já estava correta (QUESTION_MERGE_INPUT_IDS,
 * commit f5faf8a) — não alterada.
 *
 * "Manter o texto igual ao print" — o print mostra a redação ORIGINAL
 * pedida por Dr. Max no primeiro pedido desta manhã, que na ocasião foi
 * substituída pela redação já publicada (por cautela, sem instrução
 * explícita). Agora, com o print confirmando a redação desejada, os 3
 * pontos em que o texto publicado divergia do print são corrigidos:
 *   - item 2: "de doença crônica" (sem "uma") — publicado tinha "de uma
 *     doença crônica";
 *   - item 6: "há, no máximo, 180 dias" (com vírgulas) — publicado tinha
 *     "há no máximo 180 dias" (sem vírgulas);
 *   - itens 7/8: ordem trocada — "Compreende que a emissão da receita
 *     depende da avaliação médica" vem antes de "As informações
 *     fornecidas são verdadeiras" (estava na ordem inversa).
 * Os outros 5 critérios já batiam exatamente com o print — mantidos.
 *
 * Não altera nenhuma outra pergunta, grupo, variável, botão ou roteamento.
 */
require('./load-dotenv');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const STAMP = '20260724-elegibilidade-marcador-checkbox';

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
  const gElig = findGroup(t, 'fni2p22kfg51hs6s6lhcteec');
  const blkTexto = findBlock(gElig, 'iw6zqwf26frmqnp1csxiwlbm');
  const blkChoice = findBlock(gElig, 'w9v6g0rlkucnfmxc3qh2a2qt');
  const textoAntes = blockText(blkTexto);
  check('pré-condição: marcador atual é emoji numerado 1️⃣-8️⃣', ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'].every((e) => textoAntes.includes(e)));
  check('pré-condição: choice Sim/Não inalterado antes de mexer', blkChoice.items.length === 2 && blkChoice.items[0].content === 'Sim' && blkChoice.items[1].content === 'Não');

  // =====================================================================
  // Texto: marcador ✅ + redação exata do print de referência
  // =====================================================================
  blkTexto.content.richText = [
    p('p_decl_title', 'CRITÉRIOS DE ELEGIBILIDADE'),
    p('p_decl_b0', ''),
    p('p_decl_intro', 'Para continuar, confirme que:'),
    p('p_decl_b1', ''),
    p('p_decl_c1', '✅ Tem entre 18 e 80 anos;'),
    p('p_decl_cb1', ''),
    p('p_decl_c2', '✅ Possui diagnóstico prévio de doença crônica atendida pelo Doctor Prescreve;'),
    p('p_decl_cb2', ''),
    p('p_decl_c3', '✅ Utiliza a medicação de forma contínua há mais de 30 dias;'),
    p('p_decl_cb3', ''),
    p('p_decl_c4', '✅ Não apresenta sinais ou sintomas de alerta neste momento;'),
    p('p_decl_cb4', ''),
    p('p_decl_c5', '✅ Possui receita anterior válida ou documento compatível;'),
    p('p_decl_cb5', ''),
    p('p_decl_c6', '✅ A receita anterior foi emitida há, no máximo, 180 dias;'),
    p('p_decl_cb6', ''),
    p('p_decl_c7', '✅ Compreende que a emissão da receita depende da avaliação médica;'),
    p('p_decl_cb7', ''),
    p('p_decl_c8', '✅ As informações fornecidas são verdadeiras.'),
    p('p_decl_cb8', ''),
    p('p_decl_question', 'Você confirma essas informações?')
  ];
  report.fixed.push('iw6zqwf26frmqnp1csxiwlbm: marcador trocado de emoji numerado (1️⃣-8️⃣) para ✅ em todos os 8 critérios, igual ao print de referência. Redação ajustada em 3 pontos para bater exatamente com o print: item 2 sem "uma" ("de doença crônica"), item 6 com vírgulas ("há, no máximo, 180 dias"), itens 7/8 na ordem do print ("Compreende..." antes de "As informações..."). Os outros 5 critérios e o título/pergunta final não mudaram.');

  // =====================================================================
  // VALIDAÇÕES FINAIS
  // =====================================================================
  const textoDepois = blockText(t.groups.find((g) => g.id === 'fni2p22kfg51hs6s6lhcteec').blocks.find((b) => b.id === 'iw6zqwf26frmqnp1csxiwlbm'));
  check('pós: nenhum emoji numerado restante', !['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'].some((e) => textoDepois.includes(e)));
  check('pós: 8 marcadores ✅ presentes', (textoDepois.match(/✅/g) || []).length === 8);
  check('pós: os 8 critérios continuam presentes (nenhum removido)', [
    'Tem entre 18 e 80 anos', 'Possui diagnóstico prévio de doença crônica atendida pelo Doctor Prescreve',
    'Utiliza a medicação de forma contínua há mais de 30 dias', 'Não apresenta sinais ou sintomas de alerta neste momento',
    'Possui receita anterior válida ou documento compatível', 'A receita anterior foi emitida há, no máximo, 180 dias',
    'Compreende que a emissão da receita depende da avaliação médica', 'As informações fornecidas são verdadeiras'
  ].every((frag) => textoDepois.includes(frag)));
  check('pós: título/intro/pergunta final preservados', /CRITÉRIOS DE ELEGIBILIDADE/.test(textoDepois) && /Para continuar, confirme que:/.test(textoDepois) && /Você confirma essas informações\?/.test(textoDepois));
  check('pós: choice Sim/Não inalterado (values/edges)', JSON.stringify(t.groups.find((g) => g.id === 'fni2p22kfg51hs6s6lhcteec').blocks.find((b) => b.id === 'w9v6g0rlkucnfmxc3qh2a2qt').items) === JSON.stringify(before.typebot.groups.find((g) => g.id === 'fni2p22kfg51hs6s6lhcteec').blocks.find((b) => b.id === 'w9v6g0rlkucnfmxc3qh2a2qt').items));
  check('pós: corpo continua bem abaixo do limite de 1024 caracteres do WhatsApp', textoDepois.length < 1024, { tamanho: textoDepois.length });

  const danglingAfter = findDangling(t);
  const newDangling = danglingAfter.filter((id) => !danglingBefore.includes(id));
  check('V. nenhuma edge nova quebrada', newDangling.length === 0, { preExistentes: danglingBefore, novas: newDangling });

  console.log('\n=== CORRIGIDO ===');
  report.fixed.forEach((x) => console.log(' -', x));
  console.log('Assertions:', report.assertions.filter((a) => a.ok === true).length, '/', report.assertions.length, 'OK');
  console.log('\ntamanho final do texto:', textoDepois.length, 'caracteres');

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
  fs.writeFileSync(path.join(ROOT, `backups/typebot-patch-elegibilidade-marcador-checkbox-report-${STAMP}.json`), JSON.stringify(report, null, 2));

  console.log('\nOK — publicado.');
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
