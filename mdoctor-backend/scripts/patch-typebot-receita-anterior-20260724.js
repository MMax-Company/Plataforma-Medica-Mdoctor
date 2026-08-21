/**
 * Correção isolada no Typebot oficial (doctor-prescreve-8rmljgu), pedida por
 * Dr. Max em 24/07/2026 — etapa "Receita médica anterior".
 *
 * IDs exatos encontrados no JSON publicado (consultados antes de qualquer
 * alteração, nenhum inventado):
 *
 *   grp_receita_anterior          — grupo da pergunta/opções
 *     blk_receita_txt             — "Você possui uma receita médica anterior?"
 *     blk_receita_choice          — choice input, variável var_p62z9hhk
 *                                    (name: has_previous_prescription)
 *       rec_sim  -> edge_rec_sim  -> "Sim, possuo" / value "available"
 *       rec_nao  -> edge_rec_nao  -> "Não possuo"  / value "none"
 *       rec_enviar_depois -> edge_rec_enviar_depois -> "Enviar depois" / value "send_later"
 *   edge_rec_sim          -> huh6fmizvv701t9u7hc2mult (Quantidade de medicamentos)
 *   edge_rec_nao          -> grp_inelegivel_presencial
 *   edge_rec_enviar_depois -> grp_receita_enviar_depois
 *
 *   grp_inelegivel_presencial     — grupo de encerramento por "Não possuo"
 *     blk_inel_set_status         — Set variable var_vuymu8y8 (eligibility_status) = "ineligible"
 *     blk_inel_set_reason         — Set variable var_3qdmrwpx (ineligibility_reason) = "..."
 *     blk_inel_txt                — TEXTO DIVERGENTE DA MENSAGEM OFICIAL (corrigido aqui)
 *
 *   grp_receita_enviar_depois     — grupo de encerramento por "Enviar depois"
 *     blk_rx_enviar_depois_txt    — já idêntico à mensagem oficial (nenhuma alteração)
 *
 * Diagnóstico confirmado antes de alterar (ver assertions abaixo):
 *   - ordem/labels/values dos 3 botões já corretos, avanço em um único toque
 *     (cada item já tem outgoingEdgeId próprio);
 *   - nenhuma pergunta de idade da receita neste grupo;
 *   - nenhum bloco de upload/mídia neste grupo;
 *   - grp_inelegivel_presencial e grp_receita_enviar_depois são terminais
 *     (nenhuma edge sai deles) — não encaminham para medicamentos, upload,
 *     Checkout ou criação de atendimento;
 *   - mensagem de "Enviar depois" já idêntica à oficial.
 *
 * Única alteração real: texto de blk_inel_txt (grupo "Não possuo").
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const STAMP = '20260724-receita-anterior';

const report = { fixed: [], notes: [], idsConfirmados: {}, assertions: [] };
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

  // =====================================================================
  // 1) Pergunta e opções — verificação (nenhuma alteração)
  // =====================================================================
  {
    const g = findGroup(t, 'grp_receita_anterior');
    const txt = findBlock(g, 'blk_receita_txt');
    const choice = findBlock(g, 'blk_receita_choice');

    check('1) mensagem oficial', blockText(txt).trim() === 'Você possui uma receita médica anterior?');
    check('1) 3 opções, na ordem oficial', choice.items.length === 3 &&
      choice.items[0].id === 'rec_sim' && choice.items[1].id === 'rec_nao' && choice.items[2].id === 'rec_enviar_depois');
    check('1) labels oficiais', choice.items[0].content === 'Sim, possuo' &&
      choice.items[1].content === 'Não possuo' && choice.items[2].content === 'Enviar depois');
    check('1) values oficiais', choice.items[0].value === 'available' &&
      choice.items[1].value === 'none' && choice.items[2].value === 'send_later');
    check('1) todas as opções avançam com um único toque (outgoingEdgeId próprio)',
      choice.items.every((i) => Boolean(i.outgoingEdgeId)));
    check('1) variável correta (has_previous_prescription)',
      t.variables.find((v) => v.id === choice.options.variableId)?.name === 'has_previous_prescription');
    check('1) sem pergunta de idade da receita neste grupo (apenas 2 blocos no grupo)', g.blocks.length === 2);
    check('1) sem bloco de upload/mídia neste grupo', !g.blocks.some((b) => /upload|media|file|image/i.test(b.type)));

    report.idsConfirmados.grp_receita_anterior = {
      grupo: 'grp_receita_anterior',
      blocoMensagem: 'blk_receita_txt',
      blocoOpcoes: 'blk_receita_choice',
      variavel: { id: choice.options.variableId, name: 'has_previous_prescription' },
      itens: choice.items.map((i) => ({ id: i.id, content: i.content, value: i.value, outgoingEdgeId: i.outgoingEdgeId }))
    };
    report.notes.push('1) Pergunta e opções já estavam exatamente conforme o pedido (ordem, labels, values, avanço em um único toque, sem idade da receita, sem upload) — nenhuma alteração feita, apenas confirmado por assertion.');
  }

  // =====================================================================
  // Roteamento — verificação (nenhuma alteração)
  // =====================================================================
  {
    const edgeSim = t.edges.find((e) => e.id === 'edge_rec_sim');
    const edgeNao = t.edges.find((e) => e.id === 'edge_rec_nao');
    const edgeDepois = t.edges.find((e) => e.id === 'edge_rec_enviar_depois');
    check('roteamento: available -> Quantidade de medicamentos', edgeSim?.to?.groupId === 'huh6fmizvv701t9u7hc2mult');
    check('roteamento: none -> grp_inelegivel_presencial', edgeNao?.to?.groupId === 'grp_inelegivel_presencial');
    check('roteamento: send_later -> grp_receita_enviar_depois', edgeDepois?.to?.groupId === 'grp_receita_enviar_depois');
    report.idsConfirmados.roteamento = { edge_rec_sim: edgeSim.to, edge_rec_nao: edgeNao.to, edge_rec_enviar_depois: edgeDepois.to };
  }

  // =====================================================================
  // 2) Não possuo — corrigir texto de blk_inel_txt
  // =====================================================================
  {
    const g = findGroup(t, 'grp_inelegivel_presencial');
    const txt = findBlock(g, 'blk_inel_txt');
    const antes = blockText(txt);
    check('2) texto atual diverge do oficial (pré-condição)', antes.trim() !== [
      'A receita médica anterior é necessária para esta modalidade de atendimento.',
      'Sem esse documento, não será possível continuar.',
      'Recomendamos avaliação presencial ou contato com o profissional que acompanha seu tratamento.',
      'Nenhuma cobrança foi realizada.'
    ].join('\n'));

    txt.content = {
      richText: [
        { id: 'p_inel_1', type: 'p', children: [{ text: 'A receita médica anterior é necessária para esta modalidade de atendimento.' }] },
        { id: 'p_inel_2', type: 'p', children: [{ text: 'Sem esse documento, não será possível continuar.' }] },
        { id: 'p_inel_3', type: 'p', children: [{ text: 'Recomendamos avaliação presencial ou contato com o profissional que acompanha seu tratamento.' }] },
        { id: 'p_inel_4', type: 'p', children: [{ text: 'Nenhuma cobrança foi realizada.' }] }
      ]
    };

    const depois = blockText(txt);
    check('2) mensagem oficial aplicada', depois.trim() === [
      'A receita médica anterior é necessária para esta modalidade de atendimento.',
      'Sem esse documento, não será possível continuar.',
      'Recomendamos avaliação presencial ou contato com o profissional que acompanha seu tratamento.',
      'Nenhuma cobrança foi realizada.'
    ].join('\n'));
    check('2) grupo é terminal (nenhuma edge sai dele) — encerra controladamente, sem medicamentos/upload/Checkout/atendimento',
      !t.edges.some((e) => ['blk_inel_set_status', 'blk_inel_set_reason', 'blk_inel_txt'].includes(e.from.blockId)));

    report.idsConfirmados.grp_inelegivel_presencial = {
      grupo: 'grp_inelegivel_presencial',
      blocoMensagem: 'blk_inel_txt',
      textoAntes: antes,
      textoDepois: depois
    };
    report.fixed.push('2) Texto de "Não possuo" (blk_inel_txt, grupo grp_inelegivel_presencial) substituído pela mensagem oficial de 4 parágrafos. Grupo confirmado terminal (não cria atendimento, não cria Checkout, não encaminha para medicamentos/upload).');
  }

  // =====================================================================
  // 3) Enviar depois — verificação (nenhuma alteração)
  // =====================================================================
  {
    const g = findGroup(t, 'grp_receita_enviar_depois');
    const txt = findBlock(g, 'blk_rx_enviar_depois_txt');
    const atual = blockText(txt);
    const oficial = [
      'Sua solicitação foi salva e está aguardando a receita médica anterior.',
      'Nenhum pagamento será solicitado neste momento.',
      'Quando estiver com o documento, retome o atendimento pelo mesmo WhatsApp.'
    ].join('\n');
    check('3) mensagem já idêntica à oficial', atual.trim() === oficial);
    check('3) grupo é terminal (nenhuma edge sai dele) — encerra temporariamente, sem atendimento/Checkout',
      !t.edges.some((e) => e.from.blockId === 'blk_rx_enviar_depois_txt'));

    report.idsConfirmados.grp_receita_enviar_depois = {
      grupo: 'grp_receita_enviar_depois',
      blocoMensagem: 'blk_rx_enviar_depois_txt',
      texto: atual
    };
    report.notes.push('3) Mensagem de "Enviar depois" já idêntica à oficial (3 parágrafos) — nenhuma alteração feita, apenas confirmado por assertion. Grupo terminal: não cria atendimento definitivo nem Checkout. Preservação de sessão/consentimentos/dados e retomada sem reiniciar a triagem dependem do Backend (fora do escopo desta correção, que é somente Typebot) — já implementado em sessão anterior (rec_enviar_depois -> grp_receita_enviar_depois sem novo bloco/gate).');
  }

  // =====================================================================
  // VALIDAÇÕES FINAIS
  // =====================================================================
  const danglingAfter = findDangling(t);
  const newDangling = danglingAfter.filter((id) => !danglingBefore.includes(id));
  check('V. nenhuma edge nova quebrada', newDangling.length === 0, { preExistentes: danglingBefore, novas: newDangling });

  console.log('\n=== IDs CONFIRMADOS ===');
  console.log(JSON.stringify(report.idsConfirmados, null, 2));
  console.log('=== CORRIGIDO ===');
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
  fs.writeFileSync(path.join(ROOT, `backups/typebot-patch-receita-anterior-report-${STAMP}.json`), JSON.stringify(report, null, 2));

  console.log('\nOK — publicado.');
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
