/**
 * Correção isolada no Typebot oficial (doctor-prescreve-8rmljgu), pedida por
 * Dr. Max em 24/07/2026, conforme FLUXO OFICIAL PROVISÓRIO.txt (Etapas 11-12):
 * normaliza e valida o CEP, consulta o novo endpoint reutilizável do Backend
 * (GET /api/cep/:cep) e ramifica entre endereço localizado (só pede número
 * e complemento) e endereço não localizado (texto livre completo, sem pedir
 * o CEP de novo). Grupo "Dados Pessoais" (od03hfeq73l5xvs0lj9xrox3).
 *
 * Não altera medicamentos, frequência/via, condições clínicas, sinais de
 * alerta, LGPD, telemedicina, receita anterior, Stripe/pagamento, upload,
 * n8n, criação do atendimento, painel, Memed ou demais grupos/integrações.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const STAMP = '20260724-cep-endereco';
const CEP_ENDPOINT = 'https://mdoctor-backend-staging-staging.up.railway.app/api/cep/{{var_9lceldd5}}';

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

  // pré-condições
  const gDados = findGroup(t, 'od03hfeq73l5xvs0lj9xrox3');
  check('pré-condição: bloco CEP existe', gDados.blocks.some((b) => b.id === 'blk_0oydu2f7'));
  check('pré-condição: bloco endereço antigo existe', gDados.blocks.some((b) => b.id === 'blk_pergunta_endereco'));
  check('pré-condição: input endereço existe', gDados.blocks.some((b) => b.id === 'q78qjnk6ticwkeifl7xe2rju'));
  check('pré-condição: nenhuma edge aponta para blk_pergunta_endereco', !t.edges.some((e) => JSON.stringify(e).includes('blk_pergunta_endereco')));
  check('pré-condição: correção de endereço já pula para blk_pergunta_cep (nenhuma alteração necessária no item 5)',
    t.edges.some((e) => e.id === 'edge_corr_to_endereco_jump' && e.to.blockId === 'blk_pergunta_cep'));
  check('pré-condição: resumo já exibe CEP e Endereço (nenhuma alteração necessária no item 6)',
    /CEP: \{\{cep\}\}/.test(blockText(findBlock(findGroup(t, 'wupo36l29a2x66rh0bwf5yex'), 'k0i76xzc7cs84de90o94oy9i'))) &&
    /Endereço: \{\{Endereco\}\}/.test(blockText(findBlock(findGroup(t, 'wupo36l29a2x66rh0bwf5yex'), 'k0i76xzc7cs84de90o94oy9i'))));

  // =====================================================================
  // Variáveis novas
  // =====================================================================
  const newVars = [
    { id: 'var_cep_valido', name: 'cep_valido' },
    { id: 'var_cep_logradouro', name: 'cep_logradouro' },
    { id: 'var_cep_bairro', name: 'cep_bairro' },
    { id: 'var_cep_cidade', name: 'cep_cidade' },
    { id: 'var_cep_estado', name: 'cep_estado' },
    { id: 'var_cep_encontrado', name: 'cep_encontrado' },
    { id: 'var_endereco_numero_complemento', name: 'endereco_numero_complemento' }
  ];
  newVars.forEach((v) => { if (!t.variables.some((x) => x.id === v.id)) t.variables.push({ id: v.id, name: v.name, isSessionVariable: false }); });
  check('variáveis novas registradas', newVars.every((v) => t.variables.some((x) => x.id === v.id && x.name === v.name)));

  // =====================================================================
  // Bloco CEP existente: liga à normalização (sequencial, sem outgoingEdgeId)
  // =====================================================================
  const blkCep = findBlock(gDados, 'blk_0oydu2f7');
  check('bloco CEP: variável correta (var_9lceldd5)', blkCep.options.variableId === 'var_9lceldd5');
  check('bloco CEP: placeholder correto', blkCep.options.labels.placeholder === '00000000');

  // =====================================================================
  // Novos blocos: normalização, validação, erro, consulta, ramificação
  // =====================================================================
  const blkCepNormalize = {
    id: 'blk_cep_normalize',
    type: 'Set variable',
    options: {
      variableId: 'var_9lceldd5',
      expressionToEvaluate: "(function(){ var raw = '{{var_9lceldd5}}'; return (raw || '').replace(/\\D/g, ''); })()"
    }
  };
  const blkCepValidoSet = {
    id: 'blk_cep_valido_set',
    type: 'Set variable',
    options: {
      variableId: 'var_cep_valido',
      expressionToEvaluate: "(function(){ var d = '{{var_9lceldd5}}'; return /^\\d{8}$/.test(d) ? 'true' : 'false'; })()"
    }
  };
  const blkCepValidateCond = {
    id: 'blk_cep_validate_cond',
    outgoingEdgeId: 'edge_cep_invalid',
    type: 'Condition',
    items: [{
      id: 'cond_cep_valido',
      outgoingEdgeId: 'edge_cep_valid',
      content: { comparisons: [{ id: 'cmp_cep_valido', variableId: 'var_cep_valido', comparisonOperator: 'Equal to', value: 'true' }] }
    }]
  };
  const blkCepErroMsg = {
    id: 'blk_cep_erro_msg',
    outgoingEdgeId: 'edge_cep_erro_retry',
    type: 'text',
    content: { richText: [{ id: 'p_cep_erro', type: 'p', children: [{ text: 'CEP inválido. Digite os 8 números.' }] }] }
  };
  const blkConsultaCepBackend = {
    id: 'blk_consulta_cep_backend',
    outgoingEdgeId: 'edge_cep_consulta_result',
    type: 'Webhook',
    options: {
      responseVariableMapping: [
        { id: 'map_cep_logradouro', variableId: 'var_cep_logradouro', bodyPath: 'logradouro' },
        { id: 'map_cep_bairro', variableId: 'var_cep_bairro', bodyPath: 'bairro' },
        { id: 'map_cep_cidade', variableId: 'var_cep_cidade', bodyPath: 'cidade' },
        { id: 'map_cep_estado', variableId: 'var_cep_estado', bodyPath: 'estado' },
        { id: 'map_cep_encontrado', variableId: 'var_cep_encontrado', bodyPath: 'encontrado' }
      ],
      isCustomBody: true,
      webhook: {
        queryParams: [],
        headers: [{ id: 'hdr_cep_ct', key: 'Content-Type', value: 'application/json' }],
        method: 'GET',
        url: CEP_ENDPOINT,
        body: '{}'
      }
    }
  };
  const blkCepEncontradoCond = {
    id: 'blk_cep_encontrado_cond',
    outgoingEdgeId: 'edge_cep_nao_encontrado',
    type: 'Condition',
    items: [{
      id: 'cond_cep_encontrado',
      outgoingEdgeId: 'edge_cep_encontrado',
      content: { comparisons: [{ id: 'cmp_cep_encontrado', variableId: 'var_cep_encontrado', comparisonOperator: 'Equal to', value: 'true' }] }
    }]
  };
  const blkEnderecoLocalizadoMsg = {
    id: 'blk_endereco_localizado_msg',
    type: 'text',
    content: {
      richText: [
        { id: 'p_loc_1', type: 'p', children: [{ text: 'Localizamos o seguinte endereço:' }] },
        { id: 'p_loc_2', type: 'p', children: [{ text: '' }] },
        { id: 'p_loc_3', type: 'p', children: [{ text: '{{var_cep_logradouro}}, {{var_cep_bairro}}, {{var_cep_cidade}} – {{var_cep_estado}}' }] },
        { id: 'p_loc_4', type: 'p', children: [{ text: '' }] },
        { id: 'p_loc_5', type: 'p', children: [{ text: 'Informe o número e, se houver, o complemento do endereço.' }] }
      ]
    }
  };
  const blkEnderecoNumeroComplemento = {
    id: 'blk_endereco_numero_complemento',
    type: 'text input',
    options: {
      labels: { placeholder: 'Número e complemento', button: 'Enviar' },
      variableId: 'var_endereco_numero_complemento'
    }
  };
  const blkEnderecoMontarLocalizado = {
    id: 'blk_endereco_montar_localizado',
    outgoingEdgeId: 'edge_cep_localizado_route',
    type: 'Set variable',
    options: {
      variableId: 'vi35p4gd73v2cuk9ai4jw2irs',
      expressionToEvaluate:
        "(function(){ var log = '{{var_cep_logradouro}}'; var num = '{{var_endereco_numero_complemento}}'; " +
        "var bairro = '{{var_cep_bairro}}'; var cidade = '{{var_cep_cidade}}'; var estado = '{{var_cep_estado}}'; " +
        "var cep = '{{var_9lceldd5}}'; var cidadeEstado = [cidade, estado].filter(Boolean).join(' – '); " +
        "var parts = [log, num, bairro, cidadeEstado, cep].filter(Boolean); return parts.join(', '); })()"
    }
  };
  const blkEnderecoManualMsg = {
    id: 'blk_endereco_manual_msg',
    type: 'text',
    content: {
      richText: [
        { id: 'p_man_1', type: 'p', children: [{ text: 'Não foi possível localizar automaticamente o endereço.' }] },
        { id: 'p_man_2', type: 'p', children: [{ text: '' }] },
        { id: 'p_man_3', type: 'p', children: [{ text: 'Informe seu endereço completo: rua, número, bairro, cidade e estado.' }] }
      ]
    }
  };

  const blkEndereco = findBlock(gDados, 'q78qjnk6ticwkeifl7xe2rju');
  check('bloco endereço manual: variável correta (Endereco)', blkEndereco.options.variableId === 'vi35p4gd73v2cuk9ai4jw2irs');
  check('bloco endereço manual: edge de saída preservada', blkEndereco.outgoingEdgeId === 'edge_dados_to_route_check');
  blkEndereco.options.labels.placeholder = 'Rua, número, bairro, cidade e estado';

  const idxPerguntaCep = gDados.blocks.findIndex((b) => b.id === 'blk_pergunta_cep');
  const idxCep = gDados.blocks.findIndex((b) => b.id === 'blk_0oydu2f7');
  const idxPerguntaEndereco = gDados.blocks.findIndex((b) => b.id === 'blk_pergunta_endereco');
  check('ordem: pergunta CEP antes do input CEP', idxPerguntaCep === idxCep - 1);
  check('ordem: pergunta endereço antiga logo após input CEP', idxPerguntaEndereco === idxCep + 1);

  // remove o bloco antigo de pergunta de endereço (substituído por
  // blk_endereco_manual_msg) e insere a nova cadeia entre o input do CEP e
  // o input de endereço já existente (que passa a ser exclusivo do caminho
  // "não localizado").
  gDados.blocks.splice(idxPerguntaEndereco, 1); // remove blk_pergunta_endereco
  const insertAt = gDados.blocks.findIndex((b) => b.id === 'blk_0oydu2f7') + 1;
  gDados.blocks.splice(insertAt, 0,
    blkCepNormalize,
    blkCepValidoSet,
    blkCepValidateCond,
    blkCepErroMsg,
    blkConsultaCepBackend,
    blkCepEncontradoCond,
    blkEnderecoLocalizadoMsg,
    blkEnderecoNumeroComplemento,
    blkEnderecoMontarLocalizado,
    blkEnderecoManualMsg
  );

  check('bloco antigo removido', !gDados.blocks.some((b) => b.id === 'blk_pergunta_endereco'));
  check('ordem final: manual_msg imediatamente antes do input de endereço (sequencial)',
    gDados.blocks[gDados.blocks.findIndex((b) => b.id === 'q78qjnk6ticwkeifl7xe2rju') - 1].id === 'blk_endereco_manual_msg');

  // =====================================================================
  // Novas edges
  // =====================================================================
  const newEdges = [
    { id: 'edge_cep_invalid', from: { blockId: 'blk_cep_validate_cond' }, to: { groupId: 'od03hfeq73l5xvs0lj9xrox3', blockId: 'blk_cep_erro_msg' } },
    { id: 'edge_cep_valid', from: { blockId: 'blk_cep_validate_cond', itemId: 'cond_cep_valido' }, to: { groupId: 'od03hfeq73l5xvs0lj9xrox3', blockId: 'blk_consulta_cep_backend' } },
    { id: 'edge_cep_erro_retry', from: { blockId: 'blk_cep_erro_msg' }, to: { groupId: 'od03hfeq73l5xvs0lj9xrox3', blockId: 'blk_pergunta_cep' } },
    { id: 'edge_cep_consulta_result', from: { blockId: 'blk_consulta_cep_backend' }, to: { groupId: 'od03hfeq73l5xvs0lj9xrox3', blockId: 'blk_cep_encontrado_cond' } },
    { id: 'edge_cep_encontrado', from: { blockId: 'blk_cep_encontrado_cond', itemId: 'cond_cep_encontrado' }, to: { groupId: 'od03hfeq73l5xvs0lj9xrox3', blockId: 'blk_endereco_localizado_msg' } },
    { id: 'edge_cep_nao_encontrado', from: { blockId: 'blk_cep_encontrado_cond' }, to: { groupId: 'od03hfeq73l5xvs0lj9xrox3', blockId: 'blk_endereco_manual_msg' } },
    { id: 'edge_cep_localizado_route', from: { blockId: 'blk_endereco_montar_localizado' }, to: { groupId: 'grp_dados_route_end', blockId: 'blk_dados_route_cond' } }
  ];
  newEdges.forEach((e) => { if (!t.edges.some((x) => x.id === e.id)) t.edges.push(e); });
  check('7 novas edges registradas', newEdges.every((e) => t.edges.some((x) => x.id === e.id)));

  report.fixed.push('Grupo "Dados Pessoais" (od03hfeq73l5xvs0lj9xrox3): CEP passa por normalização (remove não-dígitos), validação (exatamente 8 números, com mensagem de erro e retorno somente à pergunta do CEP em caso de falha), consulta ao novo endpoint do Backend (GET /api/cep/:cep) e ramificação: localizado -> pede só número/complemento e monta Endereco completo; não localizado -> pede endereço completo em texto livre (reaproveitando o bloco existente q78qjnk6ticwkeifl7xe2rju, sem pedir o CEP de novo). Ambos os caminhos convergem para a mesma rota de retorno (grp_dados_route_end) já existente.');
  report.notes.push('Item 5 (correção posterior do endereço) e item 6 (resumo exibindo CEP/Endereço) já estavam corretos na publicação atual — nenhuma alteração foi necessária, apenas confirmados por assertion.');

  // =====================================================================
  // VALIDAÇÕES FINAIS
  // =====================================================================
  const danglingAfter = findDangling(t);
  const newDangling = danglingAfter.filter((id) => !danglingBefore.includes(id));
  check('V. nenhuma edge nova quebrada', newDangling.length === 0, { preExistentes: danglingBefore, novas: newDangling });

  check('V. edge_dados_to_route_check preservada (caminho manual)', t.edges.some((e) => e.id === 'edge_dados_to_route_check'));
  check('V. edge_corr_to_endereco_jump preservada (correção -> pergunta CEP)', t.edges.some((e) => e.id === 'edge_corr_to_endereco_jump' && e.to.blockId === 'blk_pergunta_cep'));
  check('V. rota de retorno única para ambos os caminhos (grp_dados_route_end)',
    newEdges.find((e) => e.id === 'edge_cep_localizado_route').to.groupId === 'grp_dados_route_end' &&
    t.edges.find((e) => e.id === 'edge_dados_to_route_check').to.groupId === 'grp_dados_route_end');

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
  fs.writeFileSync(path.join(ROOT, `backups/typebot-patch-cep-endereco-report-${STAMP}.json`), JSON.stringify(report, null, 2));

  console.log('\nOK — publicado.');
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
