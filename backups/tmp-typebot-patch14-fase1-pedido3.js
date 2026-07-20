/**
 * Fase 1 — terceiro e último pedido. Corrige, dentro do Typebot oficial
 * (doctor-prescreve-8rmljgu), as divergências restantes das PARTES 1-13 do
 * pedido do Dr. Max (20/07/2026), usando o levantamento e o snapshot já
 * obtidos nesta mesma sessão (sem nova auditoria geral do repositório).
 *
 * Não toca em: idade, perguntas/placeholders de dados pessoais, CEP,
 * endereço (tudo isso já corrigido no pedido 2) — apenas lê essas partes
 * para assertions de não-regressão.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const STAMP = '20260720-fase1-pedido3';

const report = { changed: [], notes: [], assertions: [] };
function check(name, ok, detail) {
  report.assertions.push({ name, ok: Boolean(ok), detail: detail === undefined ? null : detail });
  if (!ok) throw new Error(`ASSERTION FALHOU: ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`);
}
function txt(id, lines) {
  return { id, type: 'text', content: { richText: lines.map((line, i) => ({ id: `${id}_p${i}`, type: 'p', children: [{ text: line }] })) } };
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
  const danglingBefore = findDangling(before.typebot);

  // =====================================================================
  // PARTE 1 — TEMPO DE USO
  // =====================================================================
  {
    const g = findGroup(t, 'wb0gci4696hfx2s63brqetda');
    const txtBlock = findBlock(g, 'ywvtj7i2mbjcqlb8jvz0oenu');
    txtBlock.content = { richText: [{ id: 'p_tempo_uso_q', type: 'p', children: [{ text: 'Há quanto tempo você utiliza continuamente essa medicação?' }] }] };
    const choice = findBlock(g, 'r0imrcgaiv1idzkykt891q4u');
    const map1 = { xmfrlrnrkudcos98bnhilpao: ['Menos de 1 mês', 'menos_1_mes'], cx6ben72fekewftf7h8miqz8: ['De 1 a 6 meses', '1_a_6_meses'], hutcuflvz2hyyp87t78n3jdr: ['Mais de 6 meses', 'mais_6_meses'] };
    for (const item of choice.items) {
      const [content, value] = map1[item.id];
      item.content = content;
      item.value = value;
    }
    report.changed.push('PARTE 1: texto e values de "Tempo de Uso" (wb0gci4696hfx2s63brqetda)');
  }

  // =====================================================================
  // PARTE 2 — SINAIS DE ALERTA (já é pergunta única; só texto/labels)
  // =====================================================================
  {
    const g = findGroup(t, 'pjgm9a0jhn3awaa5vtmat7ko');
    check('PARTE 2 pré-condição: grupo Sinais de Alerta já é pergunta única (1 choice input)', g.blocks.filter((b) => b.type === 'choice input').length === 1);
    const txtBlock = findBlock(g, 'su7HceVXWyTCzi2vv3m4QbK');
    txtBlock.content = { richText: [{ id: 'p_sinais_q', type: 'p', children: [{ text: 'Você apresentou recentemente algum dos sinais ou sintomas abaixo?' }] }] };
    const choice = findBlock(g, 's5VQGsVF4hQgziQsXVdwPDW');
    const nenhum = choice.items.find((i) => i.id === 'it_l4dxjewc');
    if (!nenhum) throw new Error('item "Nenhum destes" não encontrado');
    nenhum.content = 'Nenhum desses sinais ou sintomas';
    if (choice.options && choice.options.buttonLabel === 'Confirmo') delete choice.options.buttonLabel;
    report.changed.push('PARTE 2: texto da pergunta, label de "Nenhum desses sinais ou sintomas" e remoção do buttonLabel "Confirmo" em Sinais de Alerta');
  }

  // =====================================================================
  // PARTE 3 — TELEMEDICINA
  // =====================================================================
  {
    const g = findGroup(t, 'grp_telemedicina_consent');
    const choice = findBlock(g, 'blk_tele_choice');
    const sim = choice.items.find((i) => i.id === 'tele_sim');
    const nao = choice.items.find((i) => i.id === 'tele_nao');
    sim.content = 'Ciente e continuar'; sim.value = 'true';
    nao.content = 'Não continuar'; nao.value = 'false';
    check('PARTE 3: variableId de telemedicina não foi alterado', choice.options.variableId === 'var_678up7nr');
    report.changed.push('PARTE 3: botões e values de Telemedicina (grp_telemedicina_consent)');
  }

  // =====================================================================
  // PARTE 4 — DECLARAÇÃO DE ELEGIBILIDADE
  // =====================================================================
  {
    const g = findGroup(t, 'fni2p22kfg51hs6s6lhcteec');
    const txtBlock = findBlock(g, 'iw6zqwf26frmqnp1csxiwlbm');
    txtBlock.content = {
      richText: [
        { id: 'p_decl_0', type: 'p', children: [{ text: '' }] },
        { id: 'p_decl_1', type: 'p', children: [{ text: '📋 CRITÉRIOS DE ELEGIBILIDADE' }] },
        { id: 'p_decl_2', type: 'p', children: [{ text: '' }] },
        { id: 'p_decl_3', type: 'p', children: [{ text: 'Para continuar, confirme que:' }] },
        { id: 'p_decl_4', type: 'p', children: [{ text: '• possui diagnóstico prévio de pelo menos uma das condições selecionadas\n• utiliza continuamente a medicação\n• não apresenta sinais de alerta neste momento\n• as informações fornecidas são verdadeiras\n• compreende que a emissão da receita depende da avaliação médica' }] },
        { id: 'p_decl_5', type: 'p', children: [{ text: '' }] },
        { id: 'p_decl_6', type: 'p', children: [{ text: 'Você confirma essas informações?' }] }
      ]
    };
    const declText = blockText(txtBlock);
    check('PARTE 4: declaração não cita receita anterior/prazo/período', !/receita anterior|prazo da receita|per[ií]odo aceito/i.test(declText), declText);
    const choice = findBlock(g, 'w9v6g0rlkucnfmxc3qh2a2qt');
    const sim = choice.items.find((i) => i.id === 'bknghkx2o6o7415qlyvv1v2t');
    const nao = choice.items.find((i) => i.id === 'uve39ku5lajo21x78dl7i335');
    sim.value = 'true';
    nao.value = 'false';
    report.changed.push('PARTE 4: texto da Declaração de elegibilidade (sem receita anterior) e values true/false');
  }

  // =====================================================================
  // PARTE 5 — RECEITA ANTERIOR (+ "Enviar depois")
  // =====================================================================
  {
    const g = findGroup(t, 'grp_receita_anterior');
    const txtBlock = findBlock(g, 'blk_receita_txt');
    txtBlock.content = { richText: [{ id: 'p_rx_q', type: 'p', children: [{ text: 'Você possui uma receita médica anterior?' }] }] };
    const choice = findBlock(g, 'blk_receita_choice');
    const sim = choice.items.find((i) => i.id === 'rec_sim');
    const nao = choice.items.find((i) => i.id === 'rec_nao');
    check('PARTE 5: "Sim, possuo" não teve seu roteamento alterado (continua no caminho existente até quantidade de medicamentos)', sim.outgoingEdgeId === 'edge_rec_sim');
    check('PARTE 5: "Não possuo" não teve seu roteamento alterado (encerramento sem cobrança já existente)', nao.outgoingEdgeId === 'edge_rec_nao');
    sim.content = 'Sim, possuo'; sim.value = 'available';
    nao.content = 'Não possuo'; nao.value = 'none';
    choice.items.push({ id: 'rec_enviar_depois', outgoingEdgeId: 'edge_rec_enviar_depois', content: 'Enviar depois', value: 'send_later' });

    t.groups.push({
      id: 'grp_receita_enviar_depois',
      title: 'Receita anterior — enviar depois',
      graphCoordinates: { x: -2700, y: -1400 },
      blocks: [txt('blk_rx_enviar_depois_txt', ['Sua solicitação foi salva e está aguardando a receita médica anterior.', 'Nenhum pagamento será solicitado neste momento.', 'Quando estiver com o documento, retome o atendimento pelo mesmo WhatsApp.'])]
    });
    t.edges.push({ id: 'edge_rec_enviar_depois', from: { blockId: 'blk_receita_choice', itemId: 'rec_enviar_depois' }, to: { groupId: 'grp_receita_enviar_depois' } });
    report.changed.push('PARTE 5: pergunta/botões oficiais de Receita anterior + nova opção "Enviar depois" (novo grupo grp_receita_enviar_depois, terminal)');
  }

  // =====================================================================
  // PARTE 6 — confirmação de que já está removido (sem ação)
  // =====================================================================
  {
    const asStr = JSON.stringify(t.groups) + JSON.stringify(t.variables);
    check('PARTE 6: pergunta de idade da receita já ausente (grp_receita_idade)', !t.groups.some((g) => g.id === 'grp_receita_idade'));
    check('PARTE 6: "emitida há quanto tempo" já ausente do Typebot', !/emitida há quanto tempo/i.test(asStr));
    check('PARTE 6: previous_prescription_age já ausente do Typebot', !/previous_prescription_age/i.test(asStr));
    report.notes.push('PARTE 6 já estava satisfeita antes desta execução (subsistema de idade da receita removido em pedido anterior) — nenhuma ação necessária.');
  }

  // =====================================================================
  // PARTE 7 — QUANTIDADE DE MEDICAMENTOS + tipos de value nas condições
  // =====================================================================
  {
    const g = findGroup(t, 'huh6fmizvv701t9u7hc2mult');
    const txtBlock = findBlock(g, 'ng82dao2u8yp3cyr8oopz1tt');
    txtBlock.content = { richText: [{ id: 'p_qtdmed_q', type: 'p', children: [{ text: 'Quantos medicamentos você deseja solicitar nesta avaliação?' }] }] };
    const choice = findBlock(g, 'w97ho902ina4lg7b6dn0sycw');
    for (const item of choice.items) {
      check(`PARTE 7: item "${item.content}" já usa value tipo string simples`, typeof item.value === 'string' && !/^".*"$/.test(item.value), item.value);
    }

    const fixQuotedValue = (bot, groupId, blockId, itemId, expected) => {
      const gg = findGroup(bot, groupId);
      const cond = findBlock(gg, blockId);
      const item = cond.items.find((i) => i.id === itemId);
      const cmp = item.content.comparisons[0];
      const before = cmp.value;
      cmp.value = expected;
      return before;
    };
    const r1 = fixQuotedValue(t, 'grp_route_after_med1', 'grp_route_after_med1_cond', 'cond_med1_eq_1', '1');
    const r2 = fixQuotedValue(t, 'grp_route_after_med1', 'grp_route_after_med1_cond', 'cond_med1_eq_2', '2');
    const r3 = fixQuotedValue(t, 'grp_route_after_med1', 'grp_route_after_med1_cond', 'cond_med1_eq_3', '3');
    const r4 = fixQuotedValue(t, 'grp_route_after_med2', 'grp_route_after_med2_cond', 'cond_med2_eq_2', '2');
    const r5 = fixQuotedValue(t, 'grp_route_after_med2', 'grp_route_after_med2_cond', 'cond_med2_eq_3', '3');
    report.changed.push(`PARTE 7: texto oficial + tipo de value normalizado nas condições de rota (antes: ${JSON.stringify([r1, r2, r3, r4, r5])} -> "1"/"2"/"2"/"3"/"3")`);
  }

  // =====================================================================
  // PARTES 8, 9, 10 — MEDICAMENTOS 1/2/3 (perguntas, frequências, vias)
  // =====================================================================
  const MED_DEFS = [
    { n: 1, ord: 'primeiro', groupId: 'w1hv8mudb1upggxvd1rldzhy', nomeId: 'blk_xp763m78', doseId: 'blk_n5x21i7c', freqId: 'blk_yyroio7i', viaId: 'blk_nggi0xs0', freqVar: 'var_8uua327o', viaVar: 'var_f58ysctc', freqOutraGroupId: 'grp_med1_freq_outra', freqOutraEdge: 'edge_med1_freq_outra', freqOutraBackEdge: 'edge_med1_freq_outra_back', freqIntervalVar: 'var_med1_freq_intervalo', freqIntervalBlockId: 'blk_med1_freq_intervalo' },
    { n: 2, ord: 'segundo', groupId: 'o1xsvn2jsapc3r1p4uf33vor', nomeId: 'blk_fjhq98ob', doseId: 'blk_e3e58xjk', freqId: 'blk_g7zx538s', viaId: 'blk_upxrgzun', freqVar: 'var_mb5cid9v', viaVar: 'var_gmomjnaw', freqOutraGroupId: 'grp_med2_freq_outra', freqOutraEdge: 'edge_med2_freq_outra', freqOutraBackEdge: 'edge_med2_freq_outra_back', freqIntervalVar: 'var_med2_freq_intervalo', freqIntervalBlockId: 'blk_med2_freq_intervalo' },
    { n: 3, ord: 'terceiro', groupId: 'iaurdgxvycgifdiuif84saz5', nomeId: 'blk_k8s4myef', doseId: 'blk_g0v3kz80', freqId: 'blk_mefdgbik', viaId: 'blk_gxda5jr4', freqVar: 'var_la7nbosl', viaVar: 'var_6u0oxmee', freqOutraGroupId: 'grp_med3_freq_outra', freqOutraEdge: 'edge_med3_freq_outra', freqOutraBackEdge: 'edge_med3_freq_outra_back', freqIntervalVar: 'var_med3_freq_intervalo', freqIntervalBlockId: 'blk_med3_freq_intervalo' }
  ];

  const FREQ_CONVERSION_EXPR = (freqVar) => `(function(){ var f = '{{${freqVar}}}'; if (f === 'Uma vez ao dia') return 'a cada 24 horas'; if (f === 'Duas vezes ao dia') return 'a cada 12 horas'; if (f === 'Três vezes ao dia') return 'a cada 8 horas'; return f; })()`;

  for (const med of MED_DEFS) {
    const g = findGroup(t, med.groupId);
    const nomeBlock = findBlock(g, med.nomeId);
    const doseBlock = findBlock(g, med.doseId);
    const freqBlock = findBlock(g, med.freqId);
    const viaBlock = findBlock(g, med.viaId);

    // PARTE 8: perguntas completas + placeholders
    doseBlock.options.labels.placeholder = '50 mg';
    check(`PARTE 8: placeholder de nome do medicamento ${med.n} já é o oficial`, nomeBlock.options.labels.placeholder === 'Nome do medicamento', nomeBlock.options.labels.placeholder);

    const idxNome = g.blocks.findIndex((b) => b.id === med.nomeId);
    g.blocks.splice(idxNome, 0, txt(`blk_pergunta_med${med.n}_nome`, [`Qual é o nome do ${med.ord} medicamento?`]));
    const idxDose = g.blocks.findIndex((b) => b.id === med.doseId);
    g.blocks.splice(idxDose, 0, txt(`blk_pergunta_med${med.n}_dose`, [`Qual é a dose do ${med.ord} medicamento?`]));
    const idxFreq = g.blocks.findIndex((b) => b.id === med.freqId);
    g.blocks.splice(idxFreq, 0, txt(`blk_pergunta_med${med.n}_freq`, [`Com que frequência você utiliza o ${med.ord} medicamento?`]));

    // PARTE 9: frequências — só as 4 opções oficiais, "Outra frequência" abre texto
    freqBlock.items = [
      { id: `it_med${med.n}_f1`, content: 'Uma vez ao dia', value: 'Uma vez ao dia' },
      { id: `it_med${med.n}_f2`, content: 'Duas vezes ao dia', value: 'Duas vezes ao dia' },
      { id: `it_med${med.n}_f3`, content: 'Três vezes ao dia', value: 'Três vezes ao dia' },
      { id: `it_med${med.n}_f4`, content: 'Outra frequência', value: 'Outra frequência', outgoingEdgeId: med.freqOutraEdge }
    ];

    // conversão interna (não mostrada ao paciente) logo após a frequência
    const idxFreqBlockNow = g.blocks.findIndex((b) => b.id === med.freqId);
    g.blocks.splice(idxFreqBlockNow + 1, 0, { id: med.freqIntervalBlockId, type: 'Set variable', options: { variableId: med.freqIntervalVar, expressionToEvaluate: FREQ_CONVERSION_EXPR(med.freqVar) } });

    const idxVia = g.blocks.findIndex((b) => b.id === med.viaId);
    g.blocks.splice(idxVia, 0, txt(`blk_pergunta_med${med.n}_via`, [`Qual é a via de administração do ${med.ord} medicamento?`]));

    // PARTE 10: vias — só as 4 oficiais, label === value
    const viaOutgoing = viaBlock.outgoingEdgeId;
    viaBlock.items = [
      { id: `it_med${med.n}_v1`, content: 'Via oral', value: 'Via oral' },
      { id: `it_med${med.n}_v2`, content: 'Via sublingual', value: 'Via sublingual' },
      { id: `it_med${med.n}_v3`, content: 'Via tópica', value: 'Via tópica' },
      { id: `it_med${med.n}_v4`, content: 'Via inalatória', value: 'Via inalatória' }
    ];
    check(`PARTE 10: roteamento de saída da via do medicamento ${med.n} preservado`, Boolean(viaOutgoing));

    // grupo "Outra frequência"
    t.groups.push({
      id: med.freqOutraGroupId,
      title: `Outra frequência — medicamento ${med.n}`,
      graphCoordinates: { x: -2200 + med.n * 50, y: -1600 + med.n * 50 },
      blocks: [
        txt(`blk_${med.freqOutraGroupId}_txt`, ['Informe a frequência exatamente como consta na receita.']),
        { id: `blk_${med.freqOutraGroupId}_input`, type: 'text input', outgoingEdgeId: med.freqOutraBackEdge, options: { variableId: med.freqVar, labels: { placeholder: 'Ex.: 1 comprimido a cada 12 horas', button: 'Enviar' } } }
      ]
    });
    t.edges.push({ id: med.freqOutraEdge, from: { blockId: med.freqId, itemId: `it_med${med.n}_f4` }, to: { groupId: med.freqOutraGroupId } });
    t.edges.push({ id: med.freqOutraBackEdge, from: { blockId: `blk_${med.freqOutraGroupId}_input` }, to: { groupId: med.groupId, blockId: `blk_pergunta_med${med.n}_via` } });

    report.changed.push(`PARTES 8/9/10: medicamento ${med.n} — perguntas completas, placeholder de dose, frequências (4 opções + conversão interna) e vias (4 opções oficiais)`);
  }

  // =====================================================================
  // PARTE 11 — CONFIRMAÇÃO DOS DADOS (+ menu de correção)
  // =====================================================================
  const VAR_CORRECTION = 'var_correction_target';
  {
    t.variables.push({ id: VAR_CORRECTION, name: 'correction_target', isSessionVariable: false });

    const g = findGroup(t, 'wupo36l29a2x66rh0bwf5yex');
    g.blocks.unshift({ id: 'blk_clear_correction_flag', type: 'Set variable', options: { variableId: VAR_CORRECTION, expressionToEvaluate: '' } });

    const txtBlock = findBlock(g, 'k0i76xzc7cs84de90o94oy9i');
    txtBlock.content = { richText: [{ id: 'p_confirm_0', type: 'p', children: [{ text: 'Confira as informações abaixo.' }] }, { id: 'p_confirm_1', type: 'p', children: [{ text: 'Os dados estão corretos?' }] }] };

    const choice = findBlock(g, 'plhspmybxbhylbfbsvqyhlmj');
    const edgeConfirmToWebhookExists = t.edges.some((e) => e.id === 'edge_confirm_to_webhook');
    check('PARTE 11: edge_confirm_to_webhook (pré-existente, órfã) está disponível para reaproveitar', edgeConfirmToWebhookExists);
    const previousItemEdge = choice.items[0] ? choice.items[0].outgoingEdgeId : null;
    report.notes.push(`PARTE 11: bug pré-existente encontrado e corrigido — o botão "Confirmar dados" apontava para a edge inexistente "${previousItemEdge}" (fluxo travava aí). Reaproveitada a edge "edge_confirm_to_webhook", já existente mas órfã, que aponta corretamente para o webhook de criação do atendimento.`);
    choice.items = [
      { id: 'resumo_confirm', outgoingEdgeId: 'edge_confirm_to_webhook', content: 'Sim, estão corretos', value: 'true' },
      { id: 'resumo_corrigir', outgoingEdgeId: 'edge_confirm_to_correction_menu', content: 'Quero corrigir', value: 'false' }
    ];
    t.edges.push({ id: 'edge_confirm_to_correction_menu', from: { blockId: 'plhspmybxbhylbfbsvqyhlmj', itemId: 'resumo_corrigir' }, to: { groupId: 'grp_correcao_menu' } });

    t.groups.push({
      id: 'grp_correcao_menu',
      title: 'Correção — seleção de grupo',
      graphCoordinates: { x: -3671, y: -700 },
      blocks: [
        txt('blk_correcao_menu_txt', ['Qual grupo você deseja corrigir?']),
        {
          id: 'blk_correcao_menu_choice', type: 'choice input',
          items: [
            { id: 'corr_dados', content: 'Dados pessoais', value: 'dados', outgoingEdgeId: 'edge_corr_to_dados' },
            { id: 'corr_endereco', content: 'Endereço', value: 'endereco', outgoingEdgeId: 'edge_corr_to_endereco' },
            { id: 'corr_condicoes', content: 'Condições clínicas', value: 'condicoes', outgoingEdgeId: 'edge_corr_to_condicoes' },
            { id: 'corr_medicamentos', content: 'Medicamentos', value: 'medicamentos', outgoingEdgeId: 'edge_corr_to_medicamentos' }
          ]
        }
      ]
    });

    const prep = [
      { id: 'grp_corr_prep_dados', flag: 'dados', edge: 'edge_corr_to_dados', to: { groupId: 'od03hfeq73l5xvs0lj9xrox3', blockId: 'emdb1ofb3knx8py3jc4ed13h' } },
      { id: 'grp_corr_prep_endereco', flag: 'endereco', edge: 'edge_corr_to_endereco', to: { groupId: 'od03hfeq73l5xvs0lj9xrox3', blockId: 'blk_pergunta_cep' } },
      { id: 'grp_corr_prep_condicoes', flag: 'condicoes', edge: 'edge_corr_to_condicoes', to: { groupId: 'vo62j813iek8fjy0uoq0ttrc', blockId: 'hda2dcvh33856qga899drcfi' } },
      { id: 'grp_corr_prep_medicamentos', flag: 'medicamentos', edge: 'edge_corr_to_medicamentos', to: { groupId: 'huh6fmizvv701t9u7hc2mult', blockId: 'ng82dao2u8yp3cyr8oopz1tt' } }
    ];
    for (const p of prep) {
      t.groups.push({ id: p.id, title: `Preparar correção — ${p.flag}`, graphCoordinates: { x: -3900, y: -700 }, blocks: [{ id: `blk_${p.id}_set`, type: 'Set variable', outgoingEdgeId: p.edge + '_jump', options: { variableId: VAR_CORRECTION, expressionToEvaluate: p.flag } }] });
      t.edges.push({ id: p.edge, from: { blockId: 'blk_correcao_menu_choice', itemId: `corr_${p.flag}` }, to: { groupId: p.id, blockId: `blk_${p.id}_set` } });
      t.edges.push({ id: p.edge + '_jump', from: { blockId: `blk_${p.id}_set` }, to: p.to });
    }

    // ---- Pontos de retorno: fim de "Dados Pessoais" (dados + endereço) ----
    const gDados = findGroup(t, 'od03hfeq73l5xvs0lj9xrox3');
    const enderecoInput = findBlock(gDados, 'q78qjnk6ticwkeifl7xe2rju');
    check('PARTE 11: bloco de endereço ainda aponta para edge_dados_to_receita (pré-condição)', enderecoInput.outgoingEdgeId === 'edge_dados_to_receita');
    const edgeDadosToReceita = t.edges.find((e) => e.id === 'edge_dados_to_receita');
    check('PARTE 11: edge_dados_to_receita existe (pré-condição)', Boolean(edgeDadosToReceita));
    const dadosToReceitaTarget = JSON.parse(JSON.stringify(edgeDadosToReceita.to));

    enderecoInput.outgoingEdgeId = 'edge_dados_to_route_check';
    t.edges.push({ id: 'edge_dados_to_route_check', from: { blockId: 'q78qjnk6ticwkeifl7xe2rju' }, to: { groupId: 'grp_dados_route_end', blockId: 'blk_dados_route_cond' } });
    t.groups.push({
      id: 'grp_dados_route_end',
      title: 'Rota de retorno — dados/endereço',
      graphCoordinates: { x: -2300, y: -1900 },
      blocks: [{
        id: 'blk_dados_route_cond', type: 'Condition', outgoingEdgeId: 'edge_dados_to_receita',
        items: [{ id: 'cond_dados_route_to_resumo', outgoingEdgeId: 'edge_dados_route_to_resumo', content: { logicalOperator: 'OR', comparisons: [{ id: 'cmp_dados_flag_1', variableId: VAR_CORRECTION, comparisonOperator: 'Equal to', value: 'dados' }, { id: 'cmp_dados_flag_2', variableId: VAR_CORRECTION, comparisonOperator: 'Equal to', value: 'endereco' }] } }]
      }]
    });
    edgeDadosToReceita.from = { blockId: 'blk_dados_route_cond' };
    check('PARTE 11: destino original de edge_dados_to_receita preservado após reaproveitar a edge', JSON.stringify(edgeDadosToReceita.to) === JSON.stringify(dadosToReceitaTarget));
    t.edges.push({ id: 'edge_dados_route_to_resumo', from: { blockId: 'blk_dados_route_cond', itemId: 'cond_dados_route_to_resumo' }, to: { groupId: 'wupo36l29a2x66rh0bwf5yex' } });

    // ---- Ponto de retorno: fim de "Doença Cronica" (condições clínicas) ----
    const gCond = findGroup(t, 'vo62j813iek8fjy0uoq0ttrc');
    const condChoice = findBlock(gCond, 'b156nm008xh7gb52n7w3egzn');
    check('PARTE 11: bloco de condições ainda aponta para edge_doenca_to_tempo (pré-condição)', condChoice.outgoingEdgeId === 'edge_doenca_to_tempo');
    const edgeDoencaToTempo = t.edges.find((e) => e.id === 'edge_doenca_to_tempo');
    check('PARTE 11: edge_doenca_to_tempo existe (pré-condição)', Boolean(edgeDoencaToTempo));
    const doencaToTempoTarget = JSON.parse(JSON.stringify(edgeDoencaToTempo.to));

    condChoice.outgoingEdgeId = 'edge_condicoes_to_route_check';
    t.edges.push({ id: 'edge_condicoes_to_route_check', from: { blockId: 'b156nm008xh7gb52n7w3egzn' }, to: { groupId: 'grp_condicoes_route_end', blockId: 'blk_condicoes_route_cond' } });
    t.groups.push({
      id: 'grp_condicoes_route_end',
      title: 'Rota de retorno — condições clínicas',
      graphCoordinates: { x: -3600, y: -2200 },
      blocks: [{
        id: 'blk_condicoes_route_cond', type: 'Condition', outgoingEdgeId: 'edge_doenca_to_tempo',
        items: [{ id: 'cond_condicoes_route_to_resumo', outgoingEdgeId: 'edge_condicoes_route_to_resumo', content: { comparisons: [{ id: 'cmp_condicoes_flag', variableId: VAR_CORRECTION, comparisonOperator: 'Equal to', value: 'condicoes' }] } }]
      }]
    });
    edgeDoencaToTempo.from = { blockId: 'blk_condicoes_route_cond' };
    check('PARTE 11: destino original de edge_doenca_to_tempo preservado após reaproveitar a edge', JSON.stringify(edgeDoencaToTempo.to) === JSON.stringify(doencaToTempoTarget));
    t.edges.push({ id: 'edge_condicoes_route_to_resumo', from: { blockId: 'blk_condicoes_route_cond', itemId: 'cond_condicoes_route_to_resumo' }, to: { groupId: 'wupo36l29a2x66rh0bwf5yex' } });

    report.notes.push('PARTE 11: "Medicamentos" não precisou de ponto de retorno dedicado — os 3 percursos de medicamento (1, 2 ou 3 itens) já convergem diretamente para "Confirmação de dados", que agora sempre limpa a flag de correção ao ser reaberta.');
    report.changed.push('PARTE 11: pergunta e botões oficiais de Confirmação dos dados, novo menu de correção (grp_correcao_menu) com 4 grupos, e roteamento de retorno para Dados pessoais/Endereço e Condições clínicas');
  }

  // =====================================================================
  // PARTE 12 — TERMOS DE USO
  // =====================================================================
  {
    const g = findGroup(t, 'grp_termos_uso');
    const intro = findBlock(g, 'blk_terms_intro');
    intro.content.richText.push({ id: 'p_terms_question', type: 'p', children: [{ text: 'Você leu e concorda com os termos?' }] });
    const choice = findBlock(g, 'blk_terms_choice');
    const agree = choice.items.find((i) => i.id === 'terms_agree');
    check('PARTE 12: roteamento de "Li e concordo" não foi alterado (continua para o pagamento já existente)', agree.outgoingEdgeId === 'edge_terms_to_accept');
    agree.content = 'Li e concordo';
    agree.value = 'true';
    choice.items.push({ id: 'terms_decline', content: 'Não concordo', value: 'false', outgoingEdgeId: 'edge_terms_to_decline' });

    t.groups.push({ id: 'grp_termos_decline', title: 'Termos não aceitos', graphCoordinates: { x: -2850, y: -1600 }, blocks: [txt('blk_termos_decline_txt', ['Tudo bem. Sem o aceite dos termos de uso não é possível seguir com a avaliação médica.', 'Nenhuma cobrança foi realizada.'])] });
    t.edges.push({ id: 'edge_terms_to_decline', from: { blockId: 'blk_terms_choice', itemId: 'terms_decline' }, to: { groupId: 'grp_termos_decline' } });
    report.changed.push('PARTE 12: pergunta explícita dos termos + botão "Não concordo" (novo grupo grp_termos_decline, terminal). Pagamento e Stripe não foram tocados.');
  }

  // =====================================================================
  // PARTE 13 — MENSAGENS FINAIS DO TYPEBOT
  // =====================================================================
  {
    const gUpload = findGroup(t, 'grp_upload_confirmed');
    const uploadTxt = findBlock(gUpload, 'blk_upload_confirmed_txt');
    uploadTxt.content = { richText: [{ id: 'p_upload_ok_1', type: 'p', children: [{ text: 'Receita anterior recebida com sucesso.' }] }, { id: 'p_upload_ok_2', type: 'p', children: [{ text: 'Estamos concluindo o envio da sua solicitação.' }] }] };

    const gFila = findGroup(t, 'bhrt6it0ud0teq3tw26q40ba');
    check('PARTE 13: grupo da fila médica já não tem pergunta "O que deseja fazer agora?" nem botões (pré-condição já satisfeita em pedido anterior)', !gFila.blocks.some((b) => b.type === 'choice input'));
    const filaTxt = findBlock(gFila, 'raqkqz8ghhcf8bylhfuisbpb');
    filaTxt.content = { richText: [{ id: 'p_fila_1', type: 'p', children: [{ text: 'Sua solicitação foi enviada para avaliação médica.' }] }, { id: 'p_fila_2', type: 'p', children: [{ text: 'Você receberá uma mensagem por este WhatsApp quando houver uma decisão.' }] }] };
    report.changed.push('PARTE 13: textos oficiais de "receita recebida" (grp_upload_confirmed) e "entrada na fila" (Group #23)');
  }

  // =====================================================================
  // VALIDAÇÕES 1-24
  // =====================================================================
  function findDangling(bot) {
    const blockIds = new Set(); bot.groups.forEach((g) => g.blocks.forEach((b) => blockIds.add(b.id)));
    const groupIds = new Set(bot.groups.map((g) => g.id));
    return bot.edges.filter((e) => {
      const fromOk = e.from.blockId ? blockIds.has(e.from.blockId) : true;
      const toOk = (e.to.groupId ? groupIds.has(e.to.groupId) : true) && (e.to.blockId ? blockIds.has(e.to.blockId) : true);
      return !fromOk || !toOk;
    }).map((e) => e.id);
  }

  // 1
  {
    const items = findBlock(findGroup(t, 'wb0gci4696hfx2s63brqetda'), 'r0imrcgaiv1idzkykt891q4u').items;
    check('1. Tempo de uso possui três opções e values oficiais', items.length === 3 && items.every((i) => ['menos_1_mes', '1_a_6_meses', 'mais_6_meses'].includes(i.value)), items.map((i) => [i.content, i.value]));
  }
  // 2
  check('2. Sinais de alerta possui uma única pergunta', findGroup(t, 'pjgm9a0jhn3awaa5vtmat7ko').blocks.filter((b) => b.type === 'choice input').length === 1);
  // 3 + 4
  {
    const gS = findGroup(t, 'pjgm9a0jhn3awaa5vtmat7ko');
    const items = findBlock(gS, 's5VQGsVF4hQgziQsXVdwPDW').items;
    check('3. "Nenhum desses" é exclusivo (rota só continua com value exatamente NAO)', items.find((i) => i.content === 'Nenhum desses sinais ou sintomas').value === 'NAO');
    check('4. Não existe gate Sim/Não dos sinais antes da lista', gS.blocks[0].id === 'su7HceVXWyTCzi2vv3m4QbK' && gS.blocks[1].id === 's5VQGsVF4hQgziQsXVdwPDW');
  }
  // 5
  {
    const items = findBlock(findGroup(t, 'grp_telemedicina_consent'), 'blk_tele_choice').items;
    check('5. Telemedicina possui os dois botões oficiais', items.some((i) => i.content === 'Ciente e continuar' && i.value === 'true') && items.some((i) => i.content === 'Não continuar' && i.value === 'false'));
  }
  // 6
  check('6. Declaração não cita receita anterior/prazo/período', !/receita anterior|prazo da receita|per[ií]odo aceito/i.test(blockText(findBlock(findGroup(t, 'fni2p22kfg51hs6s6lhcteec'), 'iw6zqwf26frmqnp1csxiwlbm'))));
  // 7
  {
    const items = findBlock(findGroup(t, 'grp_receita_anterior'), 'blk_receita_choice').items;
    check('7. Receita anterior possui três botões curtos com values oficiais', items.length === 3 && items.some((i) => i.content === 'Sim, possuo' && i.value === 'available') && items.some((i) => i.content === 'Enviar depois' && i.value === 'send_later') && items.some((i) => i.content === 'Não possuo' && i.value === 'none'));
  }
  // 8
  check('8. "Enviar depois" não alcança termos nem pagamento (grupo terminal, sem outgoing edge)', !t.edges.some((e) => e.from.blockId === 'blk_rx_enviar_depois_txt') && !findGroup(t, 'grp_receita_enviar_depois').blocks.some((b) => b.outgoingEdgeId));
  // 9 + 10
  check('9. Pergunta de idade da receita foi removida', !/emitida há quanto tempo/i.test(JSON.stringify(t.groups)));
  check('10. previous_prescription_age não aparece no resumo', !/previous_prescription_age/i.test(JSON.stringify(findGroup(t, 'wupo36l29a2x66rh0bwf5yex'))));

  // 11-13: percursos com 1, 2 e 3 medicamentos
  function traceMed(countValue) {
    const cond1 = findBlock(findGroup(t, 'grp_route_after_med1'), 'grp_route_after_med1_cond');
    const match1 = cond1.items.find((i) => i.content.comparisons[0].value === String(countValue));
    if (!match1) return null;
    let edgeId = match1.outgoingEdgeId;
    let edge = t.edges.find((e) => e.id === edgeId);
    if (!edge) return null;
    if (edge.to.groupId === 'wupo36l29a2x66rh0bwf5yex') return 'resumo';
    if (edge.to.groupId === 'o1xsvn2jsapc3r1p4uf33vor') {
      const cond2 = findBlock(findGroup(t, 'grp_route_after_med2'), 'grp_route_after_med2_cond');
      const match2 = cond2.items.find((i) => i.content.comparisons[0].value === String(countValue));
      if (!match2) return 'medicamento2-sem-rota';
      const edge2 = t.edges.find((e) => e.id === match2.outgoingEdgeId);
      if (!edge2) return null;
      if (edge2.to.groupId === 'wupo36l29a2x66rh0bwf5yex') return 'resumo';
      if (edge2.to.groupId === 'iaurdgxvycgifdiuif84saz5') {
        const viaBlock3 = findBlock(findGroup(t, 'iaurdgxvycgifdiuif84saz5'), 'blk_gxda5jr4');
        const edge3 = t.edges.find((e) => e.id === viaBlock3.outgoingEdgeId);
        return edge3 && edge3.to.groupId === 'wupo36l29a2x66rh0bwf5yex' ? 'resumo' : null;
      }
    }
    return null;
  }
  check('11. Percurso com 1 medicamento chega ao resumo', traceMed(1) === 'resumo');
  check('12. Percurso com 2 medicamentos chega ao resumo', traceMed(2) === 'resumo');
  check('13. Percurso com 3 medicamentos chega ao resumo', traceMed(3) === 'resumo');

  // 14 + 15
  for (const med of MED_DEFS) {
    const g = findGroup(t, med.groupId);
    const freqItems = findBlock(g, med.freqId).items;
    check(`14. Frequências do medicamento ${med.n} possuem somente quatro opções`, freqItems.length === 4 && freqItems.every((i) => ['Uma vez ao dia', 'Duas vezes ao dia', 'Três vezes ao dia', 'Outra frequência'].includes(i.content)), freqItems.map((i) => i.content));
    const viaItems = findBlock(g, med.viaId).items;
    check(`15. Vias do medicamento ${med.n} possuem somente quatro opções oficiais e label===value`, viaItems.length === 4 && viaItems.every((i) => i.content === i.value && ['Via oral', 'Via sublingual', 'Via tópica', 'Via inalatória'].includes(i.content)), viaItems.map((i) => [i.content, i.value]));
  }
  // 16
  {
    const items = findBlock(findGroup(t, 'wupo36l29a2x66rh0bwf5yex'), 'plhspmybxbhylbfbsvqyhlmj').items;
    check('16. Confirmação possui dois botões', items.length === 2 && items.some((i) => i.content === 'Sim, estão corretos') && items.some((i) => i.content === 'Quero corrigir'));
  }
  // 17
  {
    const prepChecks = [
      ['grp_corr_prep_dados', { groupId: 'od03hfeq73l5xvs0lj9xrox3', blockId: 'emdb1ofb3knx8py3jc4ed13h' }],
      ['grp_corr_prep_endereco', { groupId: 'od03hfeq73l5xvs0lj9xrox3', blockId: 'blk_pergunta_cep' }],
      ['grp_corr_prep_condicoes', { groupId: 'vo62j813iek8fjy0uoq0ttrc', blockId: 'hda2dcvh33856qga899drcfi' }],
      ['grp_corr_prep_medicamentos', { groupId: 'huh6fmizvv701t9u7hc2mult', blockId: 'ng82dao2u8yp3cyr8oopz1tt' }]
    ];
    for (const [gid, expected] of prepChecks) {
      const setBlock = findGroup(t, gid).blocks[0];
      const jumpEdge = t.edges.find((e) => e.id === setBlock.outgoingEdgeId);
      check(`17. Correção "${gid}" retorna somente ao grupo escolhido`, jumpEdge && JSON.stringify(jumpEdge.to) === JSON.stringify(expected), jumpEdge && jumpEdge.to);
    }
  }
  // 18
  check('18. Pergunta dos termos está presente', /Você leu e concorda com os termos\?/.test(blockText(findBlock(findGroup(t, 'grp_termos_uso'), 'blk_terms_intro'))));
  // 19
  check('19. Mensagem da fila corresponde ao texto oficial', blockText(findBlock(findGroup(t, 'bhrt6it0ud0teq3tw26q40ba'), 'raqkqz8ghhcf8bylhfuisbpb')) === 'Sua solicitação foi enviada para avaliação médica.\nVocê receberá uma mensagem por este WhatsApp quando houver uma decisão.');
  // 20
  {
    const danglingAfter = findDangling(t);
    const newDangling = danglingAfter.filter((id) => !danglingBefore.includes(id));
    check('20. Nenhuma edge ficou quebrada (nenhuma nova, além das 3 pré-existentes já conhecidas)', newDangling.length === 0, { preExistentes: danglingBefore, novas: newDangling });
  }
  // 21
  {
    const newGroupIds = ['grp_receita_enviar_depois', 'grp_med1_freq_outra', 'grp_med2_freq_outra', 'grp_med3_freq_outra', 'grp_correcao_menu', 'grp_corr_prep_dados', 'grp_corr_prep_endereco', 'grp_corr_prep_condicoes', 'grp_corr_prep_medicamentos', 'grp_dados_route_end', 'grp_condicoes_route_end', 'grp_termos_decline'];
    const groupIdsWithIncomingEdge = new Set(t.edges.map((e) => e.to.groupId).filter(Boolean));
    for (const gid of newGroupIds) {
      check(`21. Grupo novo "${gid}" não ficou órfão (possui edge de entrada)`, groupIdsWithIncomingEdge.has(gid));
    }
  }
  // 22 — pedido anterior preservado
  {
    check('22a. grp_route_idade/grp_end_idade continuam ausentes', !t.groups.some((g) => g.id === 'grp_route_idade' || g.id === 'grp_end_idade'));
    check('22b. Placeholders de Dados pessoais do pedido 2 continuam corretos', findBlock(findGroup(t, 'od03hfeq73l5xvs0lj9xrox3'), 'ds9z9lnz3yayokyy8d81fudj').options.labels.placeholder === 'Nome completo');
    check('22c. Edge Nome social -> Doença Cronica continua intacta', JSON.stringify(t.edges.find((e) => e.id === 'whhjc7rr0vzetkkpuxlgr57d')) === JSON.stringify({ id: 'whhjc7rr0vzetkkpuxlgr57d', from: { blockId: 'oq3zsok0c2tdl3qamma8tush' }, to: { groupId: 'vo62j813iek8fjy0uoq0ttrc' } }));
  }

  console.log('\n=== ALTERADO ===');
  report.changed.forEach((x) => console.log(' -', x));
  console.log('=== NOTAS ===');
  report.notes.forEach((x) => console.log(' -', x));
  console.log('Assertions:', report.assertions.filter((a) => a.ok).length, '/', report.assertions.length, 'OK');

  // ---- Publicação ----
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
  fs.writeFileSync(path.join(ROOT, `backups/typebot-patch14-report-${STAMP}.json`), JSON.stringify(report, null, 2));

  console.log('\nOK — publicado.');
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
