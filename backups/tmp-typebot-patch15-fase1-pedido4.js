/**
 * Fase 1 — quarto pedido, gerado pelas falhas do teste humano real no
 * WhatsApp. Corrige, dentro do Typebot oficial (doctor-prescreve-8rmljgu),
 * exatamente os pontos listados por Dr. Max em 20/07/2026, sem nova
 * auditoria geral (reaproveita grupos/IDs já mapeados nos pedidos 2 e 3).
 *
 * Não toca em Backend, Meta, n8n, Stripe, painel, Memed ou banco. O botão
 * "Conferir novamente" fica registrado como pendência da Fase 2 (depende
 * de Backend + recebimento de mídia pela Meta) — nenhuma ação aqui.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const STAMP = '20260720-fase1-pedido4';

const report = { fixed: [], notPossibleInScope: [], notes: [], assertions: [] };
function check(name, ok, detail) {
  report.assertions.push({ name, ok: Boolean(ok), detail: detail === undefined ? null : detail });
  if (!ok) throw new Error(`ASSERTION FALHOU: ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`);
}
function findGroup(t, id) { const g = t.groups.find((x) => x.id === id); if (!g) throw new Error('grupo não encontrado: ' + id); return g; }
function findBlock(g, id) { const b = g.blocks.find((x) => x.id === id); if (!b) throw new Error(`bloco não encontrado: ${id} em ${g.id}`); return b; }
function findEdge(t, id) { const e = t.edges.find((x) => x.id === id); if (!e) throw new Error('edge não encontrada: ' + id); return e; }
function blockText(b) { return (b.content.richText || []).map((p) => (p.children || []).map((c) => c.text || '').join('')).join('\n'); }
function plainDocParagraphs(prefix, label, url) {
  return [
    { id: `${prefix}_t`, type: 'p', children: [{ text: `📄 ${label}:` }] },
    { id: `${prefix}_u`, type: 'p', children: [{ text: url }] }
  ];
}

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
  // 1) Remover "Confirmo" das listas de condições clínicas e sinais de alerta
  // =====================================================================
  {
    const gCond = findGroup(t, 'vo62j813iek8fjy0uoq0ttrc');
    const choiceCond = findBlock(gCond, 'b156nm008xh7gb52n7w3egzn');
    check('pré-condição: "Confirmo" presente em Condições clínicas', choiceCond.options?.buttonLabel === 'Confirmo');
    delete choiceCond.options.buttonLabel;

    const gSinais = findGroup(t, 'pjgm9a0jhn3awaa5vtmat7ko');
    const choiceSinais = findBlock(gSinais, 's5VQGsVF4hQgziQsXVdwPDW');
    const jaAusente = !choiceSinais.options || choiceSinais.options.buttonLabel !== 'Confirmo';
    if (choiceSinais.options && choiceSinais.options.buttonLabel === 'Confirmo') delete choiceSinais.options.buttonLabel;
    report.fixed.push('1) "Confirmo" removido de Condições clínicas' + (jaAusente ? ' (Sinais de alerta já estava sem "Confirmo", corrigido no pedido 3)' : ' e de Sinais de alerta'));
  }

  // =====================================================================
  // 2) "Escolha uma opção:" / "Selecionado: ..." — investigado, não é
  //    conteúdo do Typebot (ver relatório final)
  // =====================================================================
  {
    const s = JSON.stringify(t);
    check('confirmação: "Escolha uma opção" não existe como conteúdo do Typebot', !/Escolha uma op/i.test(s));
    check('confirmação: "Selecionado" não existe como conteúdo do Typebot', !/Selecionado/i.test(s));
    report.notPossibleInScope.push('2) "Escolha uma opção:" é texto fixo gerado pelo Backend ao converter "choice input" do Typebot para botões/lista do WhatsApp (typebot-whatsapp.bridge.js, convertTypebotResponse) — não existe em nenhum bloco do Typebot para ser editado aqui. "Selecionado: ..." não aparece em nenhum lugar do Typebot nem do Backend — é rótulo nativo da própria interface de lista do WhatsApp ao confirmar a escolha do paciente, fora do nosso controle. Nenhuma correção possível dentro do escopo "somente Typebot" desta pedido.');
  }

  // =====================================================================
  // 3) Espaço/quebra de linha entre título do documento e a URL
  // =====================================================================
  {
    const gTele = findGroup(t, 'grp_telemedicina_consent');
    const teleDocs = findBlock(gTele, 'blk_tele_docs');
    const teleBefore = blockText(teleDocs);
    teleDocs.content = {
      richText: [
        ...plainDocParagraphs('p_tele_doc1', 'Consentimento Telemedicina Assíncrona', 'https://usihurogvphtjedyhyfl.supabase.co/storage/v1/object/public/Documentos%20Doctor%20Prescreve/Consentimento_Telemedicina_Assincrona_Doctor_Prescreve.pdf'),
        { id: 'p_tele_doc_sep', type: 'p', children: [{ text: '' }] },
        ...plainDocParagraphs('p_tele_doc2', 'Aviso Importante — Não Urgência/Emergência', 'https://usihurogvphtjedyhyfl.supabase.co/storage/v1/object/public/Documentos%20Doctor%20Prescreve/Aviso_Nao_Urgencia_Emergencia.pdf')
      ]
    };

    const gTerms = findGroup(t, 'grp_termos_uso');
    const termsDoc = findBlock(gTerms, 'blk_terms_doc');
    const termsBefore = blockText(termsDoc);
    termsDoc.content = { richText: plainDocParagraphs('p_terms_doc1', 'Política e Termos de Uso', 'https://usihurogvphtjedyhyfl.supabase.co/storage/v1/object/public/Documentos%20Doctor%20Prescreve/Politica_e_termos_de_uso_Doctor_Prescreve.pdf') };

    check('3) telemedicina: título e URL agora em linhas separadas', /Assíncrona:\nhttps/.test(blockText(teleDocs)));
    check('3) termos: título e URL agora em linhas separadas', /Uso:\nhttps/.test(blockText(termsDoc)));
    report.fixed.push(`3) Links de documentos (Telemedicina, Termos de uso) convertidos do formato "link embutido" (que concatenava título+URL sem separador) para o mesmo formato de parágrafos separados já usado corretamente em Consentimento LGPD. Antes (telemedicina): "${teleBefore.replace(/\n/g, ' | ')}"`);
  }

  // =====================================================================
  // 4) Mensagem de elegibilidade — não afirmar que dados clínicos são
  //    coletados após o pagamento
  // =====================================================================
  {
    const g = findGroup(t, 'e84h0bt9n8hgrj4ut48h245l');
    const txtBlock = findBlock(g, 'xus8mt3l0wv32b84gv9tkihm');
    const before4 = blockText(txtBlock);
    txtBlock.content = { richText: [{ id: 'p_elegivel_1', type: 'p', children: [{ text: 'Sua solicitação está inicialmente elegível para continuar.' }] }, { id: 'p_elegivel_2', type: 'p', children: [{ text: 'Agora precisamos confirmar seus dados pessoais e as informações dos medicamentos.' }] }] };
    check('4) mensagem de elegibilidade não menciona pagamento antes da coleta de dados', !/pagamento/i.test(blockText(txtBlock)));
    report.fixed.push(`4) Texto de "Solicitação Elegível" corrigido (antes: "${before4}")`);
  }

  // =====================================================================
  // 5) Reordenar: dados pessoais -> receita anterior -> medicamentos ->
  //    confirmação -> termos -> pagamento -> envio da receita
  // =====================================================================
  {
    const edgeRecSim = findEdge(t, 'edge_rec_sim');
    check('pré-condição: edge_rec_sim aponta hoje para o gate de pagamento', edgeRecSim.to.groupId === 'grp_gate_pagamento');
    edgeRecSim.to = { groupId: 'huh6fmizvv701t9u7hc2mult' };

    const edgeConfirmToWebhook = findEdge(t, 'edge_confirm_to_webhook');
    check('pré-condição: edge_confirm_to_webhook aponta hoje direto para o webhook', edgeConfirmToWebhook.to.groupId === 'g60uvyvi39v47j4ahnoxkxzn');
    edgeConfirmToWebhook.to = { groupId: 'grp_gate_pagamento', blockId: 'blk_gate_set' };

    const edgePaymentSuccess = findEdge(t, 'xxpw9p5hptmv7u7qlatptirp');
    check('pré-condição: edge do pagamento aponta hoje para quantidade de medicamentos', edgePaymentSuccess.to.groupId === 'huh6fmizvv701t9u7hc2mult');
    edgePaymentSuccess.to = { groupId: 'g60uvyvi39v47j4ahnoxkxzn', blockId: 'axuwb907imxr22bqbnugj3ab' };

    // edge_gate_to_terms e edge_terms_accept_to_payment permanecem
    // exatamente como estão — só mudou quem entra na cadeia gate->termos->
    // pagamento (agora a confirmação) e para onde ela sai no final (agora
    // o webhook).
    report.fixed.push('5) Ordem corrigida: receita anterior ("Sim, possuo") agora vai direto para Quantidade de medicamentos; Confirmação ("Sim, estão corretos") agora vai para o Gate de pagamento -> Termos -> Pagamento; Pagamento agora vai para o webhook de criação do atendimento -> envio da receita. Nenhum bloco teve seu outgoingEdgeId alterado — só o destino (to) de 3 edges já existentes (edge_rec_sim, edge_confirm_to_webhook, xxpw9p5hptmv7u7qlatptirp).');
  }

  // =====================================================================
  // 6) Resumo deve exibir dados pessoais, condições e medicamentos
  // =====================================================================
  {
    if (!t.variables.some((v) => v.id === 'vou30coxarhyas9y5q07k78k9')) {
      t.variables.push({ id: 'vou30coxarhyas9y5q07k78k9', name: 'nome_social', isSessionVariable: false });
      report.notes.push('6) Variável do nome social (vou30coxarhyas9y5q07k78k9) não tinha "name" registrado — não era possível usar {{nome_social}} em lugar nenhum. Registrada.');
    }
    t.variables.push({ id: 'var_resumo_condicoes', name: 'resumo_condicoes', isSessionVariable: false });
    t.variables.push({ id: 'var_resumo_medicamentos', name: 'resumo_medicamentos', isSessionVariable: false });

    const CONDICOES_EXPR = `(function(){ var raw = '{{doenca_cronica}}'; var map = { has: 'Hipertensão arterial', dm: 'Diabetes mellitus', dlp: 'Dislipidemia', hipotireoidismo: 'Hipotireoidismo' }; if (!raw) return '—'; var parts = raw.replace(/[\\[\\]"]/g, '').split(',').map(function(s){ return s.trim().toLowerCase(); }).filter(Boolean); var labels = parts.map(function(code){ return map[code] || code; }); return labels.length ? labels.join(', ') : '—'; })()`;
    const MEDICAMENTOS_EXPR = `(function(){ var count = Math.min(3, Math.max(1, Number('{{medication_count}}') || 1)); var meds = [ { nome: '{{med1_nome}}', dose: '{{med1_dose}}', freq: '{{med1_frequencia}}', via: '{{med1_via}}' }, { nome: '{{med2_nome}}', dose: '{{med2_dose}}', freq: '{{med2_frequencia}}', via: '{{med2_via}}' }, { nome: '{{med3_nome}}', dose: '{{med3_dose}}', freq: '{{med3_frequencia}}', via: '{{med3_via}}' } ]; var lines = []; for (var i = 0; i < count; i++) { var m = meds[i]; if (!m.nome) continue; var parts = [m.nome]; if (m.dose) parts.push(m.dose); if (m.freq) parts.push(m.freq); if (m.via) parts.push(m.via); lines.push((i + 1) + '. ' + parts.join(' — ')); } return lines.length ? lines.join('\\n') : '—'; })()`;

    const gResumo = findGroup(t, 'wupo36l29a2x66rh0bwf5yex');
    const clearFlagIdx = gResumo.blocks.findIndex((b) => b.id === 'blk_clear_correction_flag');
    check('grupo de resumo tem o bloco de limpeza de flag (do pedido 3)', clearFlagIdx !== -1);
    gResumo.blocks.splice(clearFlagIdx + 1, 0,
      { id: 'blk_resumo_set_condicoes', type: 'Set variable', options: { variableId: 'var_resumo_condicoes', expressionToEvaluate: CONDICOES_EXPR } },
      { id: 'blk_resumo_set_medicamentos', type: 'Set variable', options: { variableId: 'var_resumo_medicamentos', expressionToEvaluate: MEDICAMENTOS_EXPR } }
    );

    const txtBlock = findBlock(gResumo, 'k0i76xzc7cs84de90o94oy9i');
    txtBlock.content = {
      richText: [
        { id: 'p_confirm_0', type: 'p', children: [{ text: 'Confira as informações abaixo.' }] },
        { id: 'p_confirm_nome', type: 'p', children: [{ text: 'Nome completo: {{Nome_Completo}}' }] },
        { id: 'p_confirm_nome_social', type: 'p', children: [{ text: 'Nome social: {{nome_social}}' }] },
        { id: 'p_confirm_nasc', type: 'p', children: [{ text: 'Nascimento: {{data_nascimento}}' }] },
        { id: 'p_confirm_cpf', type: 'p', children: [{ text: 'CPF: {{cpf_paciente}}' }] },
        { id: 'p_confirm_whats', type: 'p', children: [{ text: 'WhatsApp: {{whatsapp}}' }] },
        { id: 'p_confirm_email', type: 'p', children: [{ text: 'E-mail: {{Email}}' }] },
        { id: 'p_confirm_cep', type: 'p', children: [{ text: 'CEP: {{cep}}' }] },
        { id: 'p_confirm_endereco', type: 'p', children: [{ text: 'Endereço: {{Endereco}}' }] },
        { id: 'p_confirm_condicoes', type: 'p', children: [{ text: 'Condição(ões): {{resumo_condicoes}}' }] },
        { id: 'p_confirm_meds_label', type: 'p', children: [{ text: 'Medicamentos:' }] },
        { id: 'p_confirm_meds', type: 'p', children: [{ text: '{{resumo_medicamentos}}' }] },
        { id: 'p_confirm_1', type: 'p', children: [{ text: 'Os dados estão corretos?' }] }
      ]
    };
    const resumoStr = blockText(txtBlock);
    check('6) resumo contém dados pessoais', /Nome completo: \{\{Nome_Completo\}\}/.test(resumoStr) && /CEP: \{\{cep\}\}/.test(resumoStr) && /Endereço: \{\{Endereco\}\}/.test(resumoStr));
    check('6) resumo contém condições', /Condição\(ões\): \{\{resumo_condicoes\}\}/.test(resumoStr));
    check('6) resumo contém medicamentos', /\{\{resumo_medicamentos\}\}/.test(resumoStr));
    report.fixed.push('6) Resumo agora exibe efetivamente nome completo, nome social, nascimento, CPF, WhatsApp, e-mail, CEP, endereço, condição(ões) clínica(s) e os medicamentos preenchidos (novos blocos blk_resumo_set_condicoes e blk_resumo_set_medicamentos calculam os valores legíveis).');
  }

  // =====================================================================
  // 7) "Conferir novamente" — apenas registrar pendência, nenhuma ação
  // =====================================================================
  report.notes.push('7) Botão "Conferir novamente" (upload da receita) não foi alterado, conforme pedido — registrado como pendência da Fase 2 (depende de Backend + recebimento de mídia pela Meta).');

  // =====================================================================
  // VALIDAÇÕES
  // =====================================================================
  // nenhuma opção "Confirmo" nas duas listas
  check('V1. nenhuma opção "Confirmo" em Condições clínicas', findBlock(findGroup(t, 'vo62j813iek8fjy0uoq0ttrc'), 'b156nm008xh7gb52n7w3egzn').options.buttonLabel === undefined);
  check('V1. nenhuma opção "Confirmo" em Sinais de alerta', (findBlock(findGroup(t, 'pjgm9a0jhn3awaa5vtmat7ko'), 's5VQGsVF4hQgziQsXVdwPDW').options || {}).buttonLabel === undefined);

  // apenas uma mensagem "Escolha uma opção" por etapa -> não aplicável ao Typebot (documentado acima)
  report.assertions.push({ name: 'V2. "Escolha uma opção" duplicada', ok: null, detail: 'Fora do escopo Typebot — controlado pelo Backend (bridge.js). Ver notPossibleInScope.' });

  // ordem correta até o pagamento
  {
    const chain = [];
    chain.push(findEdge(t, 'edge_rec_sim').to.groupId === 'huh6fmizvv701t9u7hc2mult');
    chain.push(findEdge(t, 'edge_confirm_to_webhook').to.groupId === 'grp_gate_pagamento');
    chain.push(findEdge(t, 'edge_gate_to_terms').to.groupId === 'grp_termos_uso');
    chain.push(findEdge(t, 'edge_terms_accept_to_payment').to.groupId === 'ulwovuu3brh5oeawwcuvr0h2');
    chain.push(findEdge(t, 'xxpw9p5hptmv7u7qlatptirp').to.groupId === 'g60uvyvi39v47j4ahnoxkxzn');
    check('V3. ordem correta até o pagamento (receita->medicamentos->confirmação->termos->pagamento->webhook)', chain.every(Boolean), chain);
  }

  // resumo completo
  {
    const resumoStr = blockText(findBlock(findGroup(t, 'wupo36l29a2x66rh0bwf5yex'), 'k0i76xzc7cs84de90o94oy9i'));
    check('V4. resumo completo (dados pessoais + condições + medicamentos)', /Nome completo/.test(resumoStr) && /Condição/.test(resumoStr) && /Medicamentos/.test(resumoStr));
  }

  // nenhuma edge quebrada (nova)
  {
    const danglingAfter = findDangling(t);
    const newDangling = danglingAfter.filter((id) => !danglingBefore.includes(id));
    check('V5. nenhuma edge nova quebrada', newDangling.length === 0, { preExistentes: danglingBefore, novas: newDangling });
  }

  // não desfazer nada do pedido 2/3
  check('não-regressão: idade continua removida', !t.variables.some((v) => v.name === 'idade_paciente'));
  check('não-regressão: placeholders de dados pessoais preservados', findBlock(findGroup(t, 'od03hfeq73l5xvs0lj9xrox3'), 'ds9z9lnz3yayokyy8d81fudj').options.labels.placeholder === 'Nome completo');
  check('não-regressão: correção "Quero corrigir" continua com 2 botões na confirmação', findBlock(findGroup(t, 'wupo36l29a2x66rh0bwf5yex'), 'plhspmybxbhylbfbsvqyhlmj').items.length === 2);

  console.log('\n=== CORRIGIDO ===');
  report.fixed.forEach((x) => console.log(' -', x));
  console.log('=== FORA DO ESCOPO TYPEBOT ===');
  report.notPossibleInScope.forEach((x) => console.log(' -', x));
  console.log('=== NOTAS ===');
  report.notes.forEach((x) => console.log(' -', x));
  console.log('Assertions:', report.assertions.filter((a) => a.ok === true).length, '/', report.assertions.filter((a) => a.ok !== null).length, 'OK');

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
  fs.writeFileSync(path.join(ROOT, `backups/typebot-patch15-report-${STAMP}.json`), JSON.stringify(report, null, 2));

  console.log('\nOK — publicado.');
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
