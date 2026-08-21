/**
 * Correção isolada no Typebot oficial (doctor-prescreve-8rmljgu): resolve a
 * causa raiz de CEP/Endereço chegarem vazios no backend, identificada por
 * investigação do teste humano real de 24/07/2026 12:49 (Dr. Max, sessão
 * ljbfx0egdglo96ec6u0ay3aq).
 *
 * CAUSA RAIZ (confirmada via Typebot Results API — var_endereco_numero_
 * complemento continha o endereço inteiro formatado, prova de que o cursor
 * real do Typebot estava no bloco nativo blk_endereco_numero_complemento, e
 * não no bloco manual q78qjnk6ticwkeifl7xe2rju como o bridge assume):
 *
 *   blk_cep_encontrado_cond (Condition) NÃO TEM NENHUMA EDGE — nem no bloco,
 *   nem no item da comparação. Sem edge, o Typebot sempre segue
 *   sequencialmente para o PRÓXIMO bloco do grupo, independente do
 *   resultado da comparação — ou seja, o fluxo SEMPRE atravessa a cadeia
 *   nativa "encontrado" (blk_endereco_localizado_msg -> blk_endereco_
 *   numero_complemento -> blk_endereco_montar_localizado), nunca a cadeia
 *   manual (blk_endereco_manual_msg -> q78qjnk6ticwkeifl7xe2rju) —
 *   independentemente de o CEP ter sido encontrado ou não.
 *
 *   O bridge (typebot-whatsapp.bridge.js, commit b2f77e2) foi escrito
 *   assumindo o oposto: que o cursor real do Typebot SEMPRE pousa no bloco
 *   manual (comentário: "caminho 'não localizado' que já funciona hoje").
 *   Essa suposição está errada no estado publicado atual, e o bridge usa
 *   coincidentemente o MESMO id do bloco nativo (blk_endereco_numero_
 *   complemento) como marcador interno próprio (CEP_NUMERO_COMPLEMENTO_
 *   SENTINEL) — quando o cursor real do Typebot pousa ali por acaso (como
 *   sempre acontece hoje), o bridge interpreta isso como "eu mesmo pedi
 *   número/complemento" e envia o endereço completo já formatado como
 *   resposta a esse campo, que o Typebot aceita literalmente como o
 *   "número e complemento" — corrompendo Endereco/cep daí em diante.
 *
 * CORREÇÃO (só no Typebot, nenhuma linha do bridge.js alterada): restaura
 * o roteamento de blk_cep_encontrado_cond para SEMPRE seguir o caminho
 * manual (blk_endereco_manual_msg -> q78qjnk6ticwkeifl7xe2rju), que é
 * exatamente o comportamento que o bridge já espera e já sabe tratar
 * corretamente (ele mesmo decide, por fora, se o CEP foi encontrado, e
 * substitui a mensagem/roteamento nesse caso). Isso torna a cadeia nativa
 * "encontrado" definitivamente inalcançável — ela já não funcionava de
 * forma confiável (o bug de visibilidade de variável no mesmo turno
 * documentado no commit anterior a b2f77e2 continua real para
 * blk_endereco_montar_localizado, que tenta ler var_cep_logradouro etc. no
 * mesmo turno em que blk_consulta_cep_backend as define), então não há
 * perda de funcionalidade real — só elimina a ambiguidade.
 *
 * Não altera nenhuma outra pergunta, grupo, variável ou bloco.
 */
const fs = require('fs');
const path = require('path');
require('./load-dotenv');

const ROOT = path.join(__dirname, '..', '..');
const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const STAMP = '20260724-cep-encontrado-cond-fix';

const report = { fixed: [], notes: [], assertions: [] };
function check(name, ok, detail) {
  report.assertions.push({ name, ok: Boolean(ok), detail: detail === undefined ? null : detail });
  if (!ok) throw new Error(`ASSERTION FALHOU: ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`);
}
function findGroup(t, id) { const g = t.groups.find((x) => x.id === id); if (!g) throw new Error('grupo não encontrado: ' + id); return g; }
function findBlock(g, id) { const b = g.blocks.find((x) => x.id === id); if (!b) throw new Error(`bloco não encontrado: ${id} em ${g.id}`); return b; }

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
  // Pré-condições — confirma o diagnóstico antes de corrigir
  // =====================================================================
  const gDados = findGroup(t, 'od03hfeq73l5xvs0lj9xrox3');
  const blkCond = findBlock(gDados, 'blk_cep_encontrado_cond');
  check('pré-condição: blk_cep_encontrado_cond não tem outgoingEdgeId próprio (causa raiz)', !blkCond.outgoingEdgeId);
  check('pré-condição: item da comparação existe mas sem outgoingEdgeId (causa raiz)',
    Array.isArray(blkCond.items) && blkCond.items.length === 1 && !blkCond.items[0].outgoingEdgeId);
  check('pré-condição: nenhuma edge parte de blk_cep_encontrado_cond hoje',
    !t.edges.some((e) => e.from.blockId === 'blk_cep_encontrado_cond'));
  check('pré-condição: blk_endereco_manual_msg e q78qjnk6ticwkeifl7xe2rju existem e seguem nessa ordem',
    gDados.blocks.findIndex((b) => b.id === 'blk_endereco_manual_msg') ===
    gDados.blocks.findIndex((b) => b.id === 'q78qjnk6ticwkeifl7xe2rju') - 1);
  check('pré-condição: q78qjnk6ticwkeifl7xe2rju ainda aponta para a rota de retorno correta',
    findBlock(gDados, 'q78qjnk6ticwkeifl7xe2rju').outgoingEdgeId === 'edge_dados_to_route_check');

  // =====================================================================
  // Correção: força blk_cep_encontrado_cond a sempre seguir para o
  // caminho manual (blk_endereco_manual_msg), removendo a ambiguidade.
  // =====================================================================
  const newEdge = {
    id: 'edge_cep_force_manual',
    from: { blockId: 'blk_cep_encontrado_cond' },
    to: { groupId: 'od03hfeq73l5xvs0lj9xrox3', blockId: 'blk_endereco_manual_msg' }
  };
  t.edges.push(newEdge);
  blkCond.outgoingEdgeId = 'edge_cep_force_manual';
  blkCond.items = [];

  report.fixed.push('blk_cep_encontrado_cond (grupo Dados Pessoais): agora sempre roteia para blk_endereco_manual_msg -> q78qjnk6ticwkeifl7xe2rju (nova edge edge_cep_force_manual), independente do valor de var_cep_encontrado. Antes, sem nenhuma edge, o bloco caía sequencialmente na cadeia nativa "encontrado" (blk_endereco_numero_complemento) em 100% dos casos — o mesmo id que o bridge usa como marcador interno (CEP_NUMERO_COMPLEMENTO_SENTINEL), causando a corrupção de Endereco/cep confirmada no teste humano de hoje 12:49 (sessão ljbfx0egdglo96ec6u0ay3aq: var_endereco_numero_complemento recebeu o endereço inteiro formatado em vez de apenas número/complemento).');
  report.notes.push('blk_endereco_localizado_msg, blk_endereco_numero_complemento e blk_endereco_montar_localizado (cadeia nativa "encontrado") ficam definitivamente inalcançáveis — mantidos no Typebot como blocos órfãos inofensivos (não removidos, para minimizar a alteração); o bridge já assumia e já trata 100% do caso "CEP encontrado" por fora (mensagem própria + construção do endereço), então nenhuma funcionalidade é perdida.');

  // =====================================================================
  // VALIDAÇÕES FINAIS
  // =====================================================================
  check('pós: blk_cep_encontrado_cond aponta para a nova edge', t.groups.find((g) => g.id === 'od03hfeq73l5xvs0lj9xrox3').blocks.find((b) => b.id === 'blk_cep_encontrado_cond').outgoingEdgeId === 'edge_cep_force_manual');
  check('pós: items da condição esvaziados (nunca mais "casa")', Array.isArray(t.groups.find((g) => g.id === 'od03hfeq73l5xvs0lj9xrox3').blocks.find((b) => b.id === 'blk_cep_encontrado_cond').items) && t.groups.find((g) => g.id === 'od03hfeq73l5xvs0lj9xrox3').blocks.find((b) => b.id === 'blk_cep_encontrado_cond').items.length === 0);
  check('pós: nova edge aponta para blk_endereco_manual_msg no grupo correto', t.edges.find((e) => e.id === 'edge_cep_force_manual')?.to?.blockId === 'blk_endereco_manual_msg' && t.edges.find((e) => e.id === 'edge_cep_force_manual')?.to?.groupId === 'od03hfeq73l5xvs0lj9xrox3');
  check('pós: rota final do endereço manual preservada', t.edges.find((e) => e.id === 'edge_dados_to_route_check')?.to?.groupId === 'grp_dados_route_end');
  check('pós: rota de correção de endereço (menu) preservada', t.edges.some((e) => e.id === 'edge_corr_to_endereco_jump' && e.to.blockId === 'blk_pergunta_cep'));

  const danglingAfter = findDangling(t);
  const newDangling = danglingAfter.filter((id) => !danglingBefore.includes(id));
  check('V. nenhuma edge nova quebrada', newDangling.length === 0, { preExistentes: danglingBefore, novas: newDangling });

  console.log('\n=== CORRIGIDO ===');
  report.fixed.forEach((x) => console.log(' -', x));
  console.log('=== NOTAS ===');
  report.notes.forEach((x) => console.log(' -', x));
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
  fs.writeFileSync(path.join(ROOT, `backups/typebot-patch-cep-encontrado-cond-fix-report-${STAMP}.json`), JSON.stringify(report, null, 2));

  console.log('\nOK — publicado.');
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
