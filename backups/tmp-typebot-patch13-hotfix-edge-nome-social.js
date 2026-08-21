/**
 * HOTFIX imediato para regressão introduzida por
 * tmp-typebot-patch12-idade-placeholders.js.
 *
 * O que aconteceu: no levantamento de 18/07 (fluxo com 63 grupos), a edge
 * "whhjc7rr0vzetkkpuxlgr57d" pertencia exclusivamente ao subsistema órfão
 * de idade (blk_route_idade_cond -> grupo Doença Crônica, dentro do grupo
 * grp_route_idade). O patch12 assumiu, por esse histórico, que remover essa
 * edge era seguro.
 *
 * Só que, entre 18/07 e 20/07, outro pedido ("pedido 1 da Fase 1")
 * reestruturou o bot e REUTILIZOU o MESMO id de edge
 * "whhjc7rr0vzetkkpuxlgr57d" para uma function completamente diferente e
 * ATIVA: é o outgoingEdgeId do bloco "oq3zsok0c2tdl3qamma8tush" (o input de
 * Nome social, grupo "Nome social") apontando para o grupo "Doença Cronica"
 * (vo62j813iek8fjy0uoq0ttrc) — ou seja, a aresta principal que leva o
 * paciente de "Nome social" para "Condições contempladas".
 *
 * O patch12 removeu essa edge (por id, sem checar o "from" atual) e
 * publicou. Resultado: bloco "oq3zsok0c2tdl3qamma8tush" ficou com
 * outgoingEdgeId apontando para uma edge inexistente — qualquer paciente
 * que respondesse "Nome social" ficaria travado ali, sem conseguir avançar
 * para "Condições contempladas".
 *
 * Este hotfix recria EXATAMENTE a mesma edge (mesmo id, mesmo from/to) que
 * existia no snapshot "antes" desta sessão, sem tocar em mais nada.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const STAMP = '20260720-hotfix-edge-nome-social';

const EDGE_ID = 'whhjc7rr0vzetkkpuxlgr57d';
const FROM_BLOCK = 'oq3zsok0c2tdl3qamma8tush';
const TO_GROUP = 'vo62j813iek8fjy0uoq0ttrc';

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

  const nomeSocialBlock = t.groups.flatMap((g) => g.blocks).find((b) => b.id === FROM_BLOCK);
  if (!nomeSocialBlock) throw new Error('bloco de nome social não encontrado');
  if (nomeSocialBlock.outgoingEdgeId !== EDGE_ID) {
    throw new Error(`outgoingEdgeId inesperado: ${nomeSocialBlock.outgoingEdgeId} (esperado ${EDGE_ID}) — a regressão pode já não existir, abortando por segurança`);
  }
  const edgeAlreadyExists = t.edges.some((e) => e.id === EDGE_ID);
  if (edgeAlreadyExists) throw new Error('edge já existe — nada a corrigir, abortando por segurança');
  const targetGroupExists = t.groups.some((g) => g.id === TO_GROUP);
  if (!targetGroupExists) throw new Error('grupo de destino (Doença Cronica) não encontrado');

  t.edges.push({ id: EDGE_ID, from: { blockId: FROM_BLOCK }, to: { groupId: TO_GROUP } });

  // Confirma que não sobrou nenhuma edge quebrada NOVA além das 3 já
  // pré-existentes e documentadas (fora de escopo, não tocadas).
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
  const dangling = findDangling(t);
  const expectedPreExisting = new Set(['gxvgai6wl7iwwc41d6lrrx6z', 'fu2odekdi7zmcs9na14bkaks', 'oeuocbgqpa3fmza0z9jrorm5']);
  const unexpected = dangling.filter((id) => !expectedPreExisting.has(id));
  if (unexpected.length) throw new Error('edges quebradas inesperadas após o hotfix: ' + JSON.stringify(unexpected));

  const patch = await fetch(`https://app.typebot.com/api/v1/typebots/${TYPEBOT_ID}`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({ typebot: { version: t.version, edges: t.edges }, overwrite: true })
  });
  console.log('PATCH HTTP', patch.status);
  if (patch.status !== 200) { console.log((await patch.text()).slice(0, 1500)); process.exit(1); }

  const pub = await fetch(`https://app.typebot.com/api/v1/typebots/${TYPEBOT_ID}/publish`, { method: 'POST', headers: H });
  console.log('PUBLISH HTTP', pub.status);
  if (pub.status !== 200) { console.log((await pub.text()).slice(0, 1500)); process.exit(1); }

  const g1 = await fetch(`https://app.typebot.com/api/v1/typebots/${TYPEBOT_ID}`, { headers: H });
  console.log('GET depois HTTP', g1.status);
  const after = await g1.json();
  fs.writeFileSync(path.join(ROOT, `backups/typebot-doctor-prescreve-depois-${STAMP}.json`), JSON.stringify(after, null, 2));

  const edgeRestored = after.typebot.edges.some((e) => e.id === EDGE_ID && e.from.blockId === FROM_BLOCK && e.to.groupId === TO_GROUP);
  console.log('edge Nome social -> Doença Cronica restaurada:', edgeRestored);
  if (!edgeRestored) { console.error('HOTFIX FALHOU NA VERIFICAÇÃO FINAL'); process.exit(1); }
  console.log('\nOK — hotfix publicado.');
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
