/**
 * Correção isolada no Typebot oficial (doctor-prescreve-8rmljgu): elimina
 * a causa raiz definitiva do bug "CEP/endereço chegam vazios no backend",
 * que já se manifestou 2 vezes hoje (commit 9d6a179 corrigiu um sintoma;
 * este patch corrige a causa real) e quebrou o teste humano das 19:37
 * (foto da receita nunca reconhecida — atendimento rejeitado por
 * "Dados obrigatórios incompletos: cep").
 *
 * PROVA REPRODUZÍVEL (chamada direta ao Typebot publicado, ANTES deste
 * patch, com um CEP válido de 8 dígitos "01209003" — o mesmo formato que
 * o bridge sempre envia, já validado/normalizado):
 *   -> SEMPRE responde "CEP inválido. Digite os 8 números." seguido de
 *      "Não foi possível localizar automaticamente o endereço...",
 *      100% das vezes, independente do CEP ser válido ou não.
 *
 * CAUSA RAIZ: blk_cep_normalize (Set variable) tem a expressão
 *   var raw = '{{var_9lceldd5}}'; return (raw||'').replace(/\D/g,'');
 * — uma leitura AUTORREFERENTE de var_9lceldd5 na MESMA rodada em que o
 * bloco de input anterior (blk_0oydu2f7) acabou de defini-la. Essa é
 * exatamente a limitação de engine já documentada no commit anterior a
 * b2f77e2 ("Webhook não vê variável setada no mesmo turno") — só que aqui
 * afeta um Set variable comum, não um Webhook: a leitura vê vazio, e o
 * bloco SOBRESCREVE var_9lceldd5 com "" — apagando o CEP que tinha acabado
 * de ser capturado corretamente pelo próprio input. Toda a cadeia seguinte
 * (blk_cep_valido_set, blk_cep_validate_cond, blk_consulta_cep_backend,
 * blk_cep_encontrado_cond) roda sobre esse valor já vazio, daí em diante
 * sem sentido — inclusive blk_cep_validate_cond não tem NENHUMA edge
 * (mesmo padrão de bug já corrigido em blk_cep_encontrado_cond no commit
 * 9d6a179), então a mensagem de erro "CEP inválido" aparece sempre,
 * mesmo com CEP correto.
 *
 * CORREÇÃO: blk_0oydu2f7 (input do CEP) passa a apontar DIRETO para
 * blk_endereco_manual_msg -> q78qjnk6ticwkeifl7xe2rju, pulando toda a
 * cadeia quebrada (blk_cep_normalize, blk_cep_valido_set,
 * blk_cep_validate_cond, blk_cep_erro_msg, blk_consulta_cep_backend,
 * blk_cep_encontrado_cond) — mantida como blocos órfãos inofensivos, não
 * removidos, para minimizar a alteração. Isso é seguro porque:
 *   1) o bridge (typebot-whatsapp.bridge.js) JÁ valida o CEP (8 dígitos)
 *      ANTES de enviar ao Typebot — a validação nativa do Typebot é
 *      redundante e, além de redundante, é a própria causa do bug;
 *   2) a experiência de "localizamos seu endereço, informe só o número"
 *      continua funcionando normalmente quando o bridge encontra o CEP —
 *      esse fluxo é 100% construído pelo bridge por fora (substitui a
 *      mensagem e o próximo input esperado independente do que o Typebot
 *      diz), não depende em nada da cadeia nativa que está sendo
 *      desativada aqui.
 *
 * Não altera nenhuma outra pergunta, grupo, variável ou roteamento.
 */
require('./load-dotenv');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const STAMP = '20260724-cep-remove-cadeia-quebrada';

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
  // Pré-condições
  // =====================================================================
  const g = findGroup(t, 'od03hfeq73l5xvs0lj9xrox3');
  const blkCep = findBlock(g, 'blk_0oydu2f7');
  check('pré-condição: blk_0oydu2f7 ainda não tem outgoingEdgeId próprio (sequencial hoje)', !blkCep.outgoingEdgeId);
  check('pré-condição: variável correta (var_9lceldd5)', blkCep.options.variableId === 'var_9lceldd5');
  check('pré-condição: blk_endereco_manual_msg existe', g.blocks.some((b) => b.id === 'blk_endereco_manual_msg'));
  check('pré-condição: blk_cep_normalize (causa raiz) ainda tem a leitura autorreferente', findBlock(g, 'blk_cep_normalize').options.expressionToEvaluate.includes("{{var_9lceldd5}}"));

  // =====================================================================
  // Correção: pula toda a cadeia quebrada (normalize/valido/validate/erro/
  // consulta/encontrado), indo direto para o endereço manual.
  // =====================================================================
  const newEdge = {
    id: 'edge_cep_direto_endereco_manual',
    from: { blockId: 'blk_0oydu2f7' },
    to: { groupId: 'od03hfeq73l5xvs0lj9xrox3', blockId: 'blk_endereco_manual_msg' }
  };
  t.edges.push(newEdge);
  blkCep.outgoingEdgeId = 'edge_cep_direto_endereco_manual';

  report.fixed.push('blk_0oydu2f7 (input do CEP): agora aponta direto para blk_endereco_manual_msg -> q78qjnk6ticwkeifl7xe2rju (nova edge edge_cep_direto_endereco_manual), pulando toda a cadeia nativa quebrada de normalização/validação/consulta de CEP (blk_cep_normalize, blk_cep_valido_set, blk_cep_validate_cond, blk_cep_erro_msg, blk_consulta_cep_backend, blk_cep_encontrado_cond — mantidos como blocos órfãos, não removidos). Causa raiz: blk_cep_normalize lia {{var_9lceldd5}} na mesma rodada em que acabara de ser definida (limitação de engine do Typebot), via vazio, e SOBRESCREVIA a variável com string vazia — apagando o CEP correto capturado pelo próprio input, mesmo quando válido. Reproduzido ao vivo antes deste patch: CEP válido "01209003" sempre resultava em "CEP inválido. Digite os 8 números." O bridge já valida o CEP (8 dígitos) antes de enviar ao Typebot — a cadeia nativa era 100% redundante e, pior, destrutiva.');

  // =====================================================================
  // VALIDAÇÕES FINAIS
  // =====================================================================
  const gAfter = t.groups.find((x) => x.id === 'od03hfeq73l5xvs0lj9xrox3');
  check('pós: blk_0oydu2f7 aponta para a nova edge', gAfter.blocks.find((b) => b.id === 'blk_0oydu2f7').outgoingEdgeId === 'edge_cep_direto_endereco_manual');
  check('pós: nova edge aponta para blk_endereco_manual_msg no grupo correto', t.edges.find((e) => e.id === 'edge_cep_direto_endereco_manual')?.to?.blockId === 'blk_endereco_manual_msg' && t.edges.find((e) => e.id === 'edge_cep_direto_endereco_manual')?.to?.groupId === 'od03hfeq73l5xvs0lj9xrox3');
  check('pós: rota final do endereço manual preservada (q78qjnk6ticwkeifl7xe2rju -> grp_dados_route_end)', t.edges.find((e) => e.id === 'edge_dados_to_route_check')?.to?.groupId === 'grp_dados_route_end');
  check('pós: rota de correção de endereço (menu) preservada', t.edges.some((e) => e.id === 'edge_corr_to_endereco_jump' && e.to.blockId === 'blk_pergunta_cep'));
  check('pós: fix anterior (edge_cep_force_manual) continua intacto (não afetado por este patch)', t.edges.some((e) => e.id === 'edge_cep_force_manual'));

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
  fs.writeFileSync(path.join(ROOT, `backups/typebot-patch-cep-remove-cadeia-quebrada-report-${STAMP}.json`), JSON.stringify(report, null, 2));

  console.log('\nOK — publicado.');
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
