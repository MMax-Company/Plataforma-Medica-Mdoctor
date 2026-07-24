/**
 * Correção isolada no Typebot oficial (doctor-prescreve-8rmljgu), pedida por
 * Dr. Max em 24/07/2026, conforme FLUXO OFICIAL PROVISÓRIO.txt (Etapas 14-16):
 *
 *   1) Quantidade de medicamentos: confirma que já registra medication_count
 *      e avança direto para Medicamento 1, sem "Confirmar" (nenhuma alteração
 *      necessária — verificado por assertion).
 *   2) Frequência de cada medicamento (1, 2 e 3): remove a opção
 *      "Outra frequência", mantendo somente Uma/Duas/Três vezes ao dia.
 *   3) Via de administração de cada medicamento (1, 2 e 3): remove
 *      "Via tópica" e "Via inalatória", mantendo Via oral, Via sublingual e
 *      acrescentando Via subcutânea (label = value, igual às demais).
 *   4) Remove os grupos e edges exclusivos de "Outra frequência" (1, 2 e 3),
 *      sem tocar nos blocos internos de conversão de frequência
 *      (blk_med{1,2,3}_freq_intervalo), que permanecem intactos.
 *
 * Não altera Backend, bridge do WhatsApp, n8n, Stripe, pagamento, upload da
 * receita, criação do atendimento, painel, Memed, outros grupos do Typebot
 * ou a ordem geral do fluxo.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const STAMP = '20260724-medicamentos-freq-via';

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
  // 1) Quantidade de medicamentos — verificação (nenhuma alteração)
  // =====================================================================
  {
    const gQtd = findGroup(t, 'huh6fmizvv701t9u7hc2mult');
    const choiceQtd = findBlock(gQtd, 'w97ho902ina4lg7b6dn0sycw');
    check('1) 3 opções de quantidade (1, 2, 3)', choiceQtd.items.length === 3 &&
      choiceQtd.items.map((i) => i.value).join(',') === '1,2,3');
    check('1) todas as opções avançam direto para Medicamento 1, sem Confirmar',
      choiceQtd.items.every((i) => i.outgoingEdgeId === 'edge_medcount_to_med1'));
    const varQtd = t.variables.find((v) => v.id === choiceQtd.options.variableId);
    check('1) variável correta (medication_count)', varQtd && varQtd.name === 'medication_count');
    report.notes.push('1) Quantidade de medicamentos já registrava medication_count e avançava imediatamente para Medicamento 1, sem botão Confirmar — nenhuma alteração necessária, apenas confirmado por assertion.');
  }

  // =====================================================================
  // 2) e 3) Frequência e Via — Medicamento 1, 2 e 3
  // =====================================================================
  const meds = [
    { n: 1, groupId: 'w1hv8mudb1upggxvd1rldzhy', freqBlock: 'blk_yyroio7i', freqOutraItem: 'it_med1_f4', viaBlock: 'blk_nggi0xs0', viaTopicaItem: 'it_med1_v3', viaInalatoriaItem: 'it_med1_v4' },
    { n: 2, groupId: 'o1xsvn2jsapc3r1p4uf33vor', freqBlock: 'blk_g7zx538s', freqOutraItem: 'it_med2_f4', viaBlock: 'blk_upxrgzun', viaTopicaItem: 'it_med2_v3', viaInalatoriaItem: 'it_med2_v4' },
    { n: 3, groupId: 'iaurdgxvycgifdiuif84saz5', freqBlock: 'blk_mefdgbik', freqOutraItem: 'it_med3_f4', viaBlock: 'blk_gxda5jr4', viaTopicaItem: 'it_med3_v3', viaInalatoriaItem: 'it_med3_v4' }
  ];

  for (const med of meds) {
    const g = findGroup(t, med.groupId);

    // Frequência: remover "Outra frequência"
    const freq = findBlock(g, med.freqBlock);
    check(`2) med${med.n}: 4 opções de frequência antes (com Outra frequência)`, freq.items.length === 4 && freq.items[3].id === med.freqOutraItem);
    freq.items = freq.items.filter((i) => i.id !== med.freqOutraItem);
    check(`2) med${med.n}: 3 opções de frequência depois`, freq.items.length === 3 &&
      freq.items.map((i) => i.value).join(',') === 'Uma vez ao dia,Duas vezes ao dia,Três vezes ao dia');

    // Via: remover "Via tópica" e "Via inalatória", acrescentar "Via subcutânea"
    const via = findBlock(g, med.viaBlock);
    check(`3) med${med.n}: 4 opções de via antes (oral, sublingual, tópica, inalatória)`, via.items.length === 4);
    const topicaItem = via.items.find((i) => i.id === med.viaTopicaItem);
    check(`3) med${med.n}: item de via tópica encontrado`, Boolean(topicaItem) && topicaItem.content === 'Via tópica');
    topicaItem.content = 'Via subcutânea';
    topicaItem.value = 'Via subcutânea';
    via.items = via.items.filter((i) => i.id !== med.viaInalatoriaItem);
    check(`3) med${med.n}: 3 opções de via depois (oral, sublingual, subcutânea)`, via.items.length === 3 &&
      via.items.map((i) => i.value).join(',') === 'Via oral,Via sublingual,Via subcutânea');
    check(`3) med${med.n}: label = value em todas as opções de via`, via.items.every((i) => i.content === i.value));

    report.fixed.push(`med${med.n}: frequência sem "Outra frequência" (3 opções); via sem tópica/inalatória, com Via subcutânea (3 opções)`);
  }

  // =====================================================================
  // 4) Remover grupos e edges exclusivos de "Outra frequência"
  // =====================================================================
  {
    const groupsToRemove = ['grp_med1_freq_outra', 'grp_med2_freq_outra', 'grp_med3_freq_outra'];
    const edgesToRemove = [
      'edge_med1_freq_outra', 'edge_med1_freq_outra_back',
      'edge_med2_freq_outra', 'edge_med2_freq_outra_back',
      'edge_med3_freq_outra', 'edge_med3_freq_outra_back'
    ];
    groupsToRemove.forEach((id) => check(`4) grupo ${id} existe antes da remoção`, t.groups.some((g) => g.id === id)));
    edgesToRemove.forEach((id) => check(`4) edge ${id} existe antes da remoção`, t.edges.some((e) => e.id === id)));

    t.groups = t.groups.filter((g) => !groupsToRemove.includes(g.id));
    t.edges = t.edges.filter((e) => !edgesToRemove.includes(e.id));

    groupsToRemove.forEach((id) => check(`4) grupo ${id} removido`, !t.groups.some((g) => g.id === id)));
    edgesToRemove.forEach((id) => check(`4) edge ${id} removida`, !t.edges.some((e) => e.id === id)));

    // blocos de conversão de frequência preservados
    ['blk_med1_freq_intervalo', 'blk_med2_freq_intervalo', 'blk_med3_freq_intervalo'].forEach((blockId, idx) => {
      const g = findGroup(t, meds[idx].groupId);
      check(`4) bloco de conversão ${blockId} preservado`, g.blocks.some((b) => b.id === blockId));
    });

    report.fixed.push('4) Grupos grp_med1_freq_outra, grp_med2_freq_outra, grp_med3_freq_outra e as 6 edges exclusivas removidos; blocos de conversão de frequência (24h/12h/8h) preservados.');
  }

  // =====================================================================
  // VALIDAÇÕES FINAIS
  // =====================================================================
  const danglingAfter = findDangling(t);
  const newDangling = danglingAfter.filter((id) => !danglingBefore.includes(id));
  check('V. nenhuma edge nova quebrada', newDangling.length === 0, { preExistentes: danglingBefore, novas: newDangling });

  // roteamento geral preservado (não tocado neste pedido)
  check('V. edge_medcount_to_med1 preservada', t.edges.some((e) => e.id === 'edge_medcount_to_med1'));
  check('V. edge_med1_to_route preservada', t.edges.some((e) => e.id === 'edge_med1_to_route'));
  check('V. edge_med2_to_route preservada', t.edges.some((e) => e.id === 'edge_med2_to_route'));
  check('V. edge_med3_to_foto preservada', t.edges.some((e) => e.id === 'edge_med3_to_foto'));

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
  fs.writeFileSync(path.join(ROOT, `backups/typebot-patch-medicamentos-report-${STAMP}.json`), JSON.stringify(report, null, 2));

  console.log('\nOK — publicado.');
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
