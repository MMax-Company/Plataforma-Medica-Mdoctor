/**
 * Bloco Resumo dos dados:
 * - textos legíveis (sem códigos internos)
 * - idade calculada pela data de nascimento
 * - medicamentos preenchidos
 * - opções de confirmar / corrigir com retorno parcial ao fluxo
 */
const fs = require('fs');
const path = require('path');

const IDS = {
  grpResumo: 'wupo36l29a2x66rh0bwf5yex',
  grpDados: 'od03hfeq73l5xvs0lj9xrox3',
  grpMedCount: 'huh6fmizvv701t9u7hc2mult',
  grpReceita: 'grp_receita_anterior',
  dadosCepBlock: 'blk_0oydu2f7',
  choiceBlock: 'plhspmybxbhylbfbsvqyhlmj',
  confirmItem: 'resumo_confirm',
  corrDadosItem: 'resumo_corr_dados',
  corrMedsItem: 'resumo_corr_meds',
  clearFlagBlock: 'blk_resumo_clear_flag',
  buildBlock: 'blk_resumo_build',
  textBlock: 'k0i76xzc7cs84de90o94oy9i',
  prepDadosGroup: 'grp_resumo_prep_dados',
  prepDadosSet: 'blk_resumo_set_corr_dados',
  dadosRouteGroup: 'grp_dados_route',
  dadosRouteCond: 'blk_dados_route_cond',
  dadosRouteToResumo: 'cond_dados_to_resumo',
  dadosRouteToReceita: 'cond_dados_to_receita'
};

const RESUMO_JS = `
const mapCondicao = (raw) => {
  const map = {
    has: 'Hipertensão arterial',
    hipertensao: 'Hipertensão arterial',
    dm: 'Diabetes mellitus',
    dlp: 'Dislipidemia',
    hipotireoidismo: 'Hipotireoidismo'
  };
  const label = (code) => {
    const key = String(code || '').trim().toLowerCase();
    return map[key] || '';
  };
  if (Array.isArray(raw)) {
    const labels = raw.map(label).filter(Boolean);
    return labels.length ? labels.join('; ') : '—';
  }
  const text = String(raw || '').trim();
  if (!text) return '—';
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return mapCondicao(parsed);
    } catch (_) {}
  }
  if (text.includes(',')) {
    const labels = text.split(',').map((part) => label(part)).filter(Boolean);
    return labels.length ? labels.join('; ') : '—';
  }
  return label(text) || '—';
};

const mapReceitaStatus = (raw) => {
  const map = {
    sim: 'Receita disponível para envio',
    available_now: 'Receita disponível para envio',
    not_available_now: 'Receita indisponível no momento',
    none: 'Sem receita anterior',
    nao: 'Sem receita anterior'
  };
  const key = String(raw || '').trim().toLowerCase();
  return map[key] || '—';
};

const mapReceitaEmissao = (raw) => {
  const map = {
    within_180_days: 'Receita emitida há até 180 dias',
    over_180_days: 'Receita emitida há mais de 180 dias',
    unknown: 'Data da receita não informada'
  };
  const key = String(raw || '').trim().toLowerCase();
  return map[key] || '';
};

const calcIdade = (rawBirth) => {
  const raw = String(rawBirth || '').trim();
  if (!raw) return '—';
  let day;
  let month;
  let year;
  const digits = raw.replace(/\\D/g, '');
  if (digits.length === 8) {
    day = Number(digits.slice(0, 2));
    month = Number(digits.slice(2, 4));
    year = Number(digits.slice(4, 8));
  } else {
    const match = raw.match(/^(\\d{1,2})[\\/\\-.](\\d{1,2})[\\/\\-.](\\d{4})$/);
    if (!match) return '—';
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  }
  const birth = new Date(year, month - 1, day);
  if (Number.isNaN(birth.getTime())) return '—';
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age >= 0 && age <= 130 ? String(age) : '—';
};

const count = Math.min(3, Math.max(1, Number({{medication_count}}) || 1));
const slots = [
  { nome: {{med1_nome}}, dose: {{med1_dose}}, freq: {{med1_frequencia}}, via: {{med1_via}} },
  { nome: {{med2_nome}}, dose: {{med2_dose}}, freq: {{med2_frequencia}}, via: {{med2_via}} },
  { nome: {{med3_nome}}, dose: {{med3_dose}}, freq: {{med3_frequencia}}, via: {{med3_via}} }
];
const meds = [];
for (let i = 0; i < count; i += 1) {
  const slot = slots[i] || {};
  const nome = String(slot.nome || '').trim();
  if (!nome) continue;
  const dose = String(slot.dose || '').trim();
  const freq = String(slot.freq || '').trim();
  const via = String(slot.via || '').trim();
  const parts = [nome];
  if (dose) parts.push(dose);
  if (freq) parts.push(freq);
  if (via) parts.push('via ' + via);
  meds.push((i + 1) + '. ' + parts.join(' — '));
}

const receitaStatus = mapReceitaStatus({{has_previous_prescription}});
const receitaEmissao = mapReceitaEmissao({{previous_prescription_age}});

const lines = [
  '📋 RESUMO DOS DADOS',
  '',
  'Nome: ' + String({{Nome_Completo}} || '—').trim(),
  'Idade: ' + calcIdade({{data_nascimento}}) + ' anos',
  'CPF: ' + String({{cpf_paciente}} || '—').trim(),
  'WhatsApp: ' + String({{whatsapp}} || '—').trim(),
  'E-mail: ' + String({{Email}} || '—').trim(),
  'Endereço: ' + String({{Endereco}} || '—').trim(),
  'CEP: ' + String({{cep}} || '—').trim(),
  'Condição: ' + mapCondicao({{doenca_cronica}}),
  'Receita: ' + receitaStatus
];
if (receitaEmissao) lines.push('Emissão: ' + receitaEmissao);
lines.push('', 'Medicamentos:');
lines.push(meds.length ? meds.join('\\n') : '—');
lines.push('', 'Confira se está tudo correto antes de continuar.');
lines.push('', 'Escolha uma opção:');
lines.push('• Sim, confirmar e continuar');
lines.push('• Corrigir dados pessoais');
lines.push('• Corrigir medicamentos');
return lines.join('\\n');
`.trim();

function ensureVariable(bot, name, id) {
  bot.variables = bot.variables || [];
  let variable = bot.variables.find((v) => v.name === name);
  if (!variable) {
    variable = { id, name, isSessionVariable: false };
    bot.variables.push(variable);
  }
  return variable;
}

function setVarBlock(id, variableId, expression) {
  return {
    id,
    type: 'Set variable',
    options: { variableId, expressionToEvaluate: expression }
  };
}

function richParagraph(id, text) {
  return { id, type: 'p', children: [{ text }] };
}

function upsertEdge(bot, edge) {
  bot.edges = bot.edges || [];
  const idx = bot.edges.findIndex((e) => e.id === edge.id);
  if (idx >= 0) bot.edges[idx] = edge;
  else bot.edges.push(edge);
}

function removeEdges(bot, ids) {
  bot.edges = (bot.edges || []).filter((e) => !ids.includes(e.id));
}

function patchResumoDados(bot) {
  const resumoVar = ensureVariable(bot, 'resumo_dados', 'var_resumo_dados');
  const corrVar = ensureVariable(bot, 'corrigindo_secao', 'var_corrigindo_secao');
  ensureVariable(bot, 'previous_prescription_age', 'var_previous_prescription_age');

  const resumo = bot.groups.find((g) => g.id === IDS.grpResumo);
  if (!resumo) throw new Error('Grupo Resumo/Confirmação não encontrado');

  resumo.title = 'Resumo dos dados';
  resumo.blocks = [
    setVarBlock(IDS.clearFlagBlock, corrVar.id, '""'),
    setVarBlock(IDS.buildBlock, resumoVar.id, RESUMO_JS),
    {
      id: IDS.textBlock,
      type: 'text',
      content: {
        richText: [richParagraph('p_resumo_body', '{{resumo_dados}}')]
      }
    },
    {
      id: IDS.choiceBlock,
      type: 'choice input',
      items: [
        {
          id: IDS.confirmItem,
          content: 'Sim, confirmar e continuar',
          value: 'confirmar',
          outgoingEdgeId: 'edge_confirm_to_webhook'
        },
        {
          id: IDS.corrDadosItem,
          content: 'Corrigir dados pessoais',
          value: 'corrigir_dados',
          outgoingEdgeId: 'edge_resumo_to_prep_dados'
        },
        {
          id: IDS.corrMedsItem,
          content: 'Corrigir medicamentos',
          value: 'corrigir_meds',
          outgoingEdgeId: 'edge_resumo_to_medcount'
        }
      ]
    }
  ];

  let prep = bot.groups.find((g) => g.id === IDS.prepDadosGroup);
  if (!prep) {
    prep = {
      id: IDS.prepDadosGroup,
      title: 'Resumo — preparar correção de dados',
      graphCoordinates: { x: -3400, y: 120 },
      blocks: []
    };
    bot.groups.push(prep);
  }
  prep.blocks = [
    setVarBlock(IDS.prepDadosSet, corrVar.id, '"dados"'),
    {
      id: 'blk_resumo_prep_dados_done',
      outgoingEdgeId: 'edge_prep_dados_to_dados',
      type: 'text',
      content: {
        richText: [richParagraph('p_resumo_prep_dados', 'Vamos corrigir seus dados pessoais.')]
      }
    }
  ];

  let route = bot.groups.find((g) => g.id === IDS.dadosRouteGroup);
  if (!route) {
    route = {
      id: IDS.dadosRouteGroup,
      title: 'Rota após dados pessoais',
      graphCoordinates: { x: -1900, y: -2100 },
      blocks: []
    };
    bot.groups.push(route);
  }
  route.blocks = [
    {
      id: IDS.dadosRouteCond,
      type: 'Condition',
      items: [
        {
          id: IDS.dadosRouteToResumo,
          outgoingEdgeId: 'edge_dados_to_resumo',
          content: {
            comparisons: [
              {
                id: 'cmp_dados_corr_resumo',
                variableId: corrVar.id,
                comparisonOperator: 'Equal to',
                value: '"dados"'
              }
            ]
          }
        },
        {
          id: IDS.dadosRouteToReceita,
          outgoingEdgeId: 'edge_dados_to_receita',
          content: {
            comparisons: [
              {
                id: 'cmp_dados_to_receita',
                variableId: corrVar.id,
                comparisonOperator: 'Not equal',
                value: '"dados"'
              }
            ]
          }
        }
      ]
    }
  ];

  const dados = bot.groups.find((g) => g.id === IDS.grpDados);
  const cepBlock = dados?.blocks?.find((b) => b.id === IDS.dadosCepBlock);
  if (cepBlock) cepBlock.outgoingEdgeId = 'edge_dados_to_route';

  removeEdges(bot, ['edge_dados_to_receita']);

  upsertEdge(bot, {
    id: 'edge_dados_to_route',
    from: { blockId: IDS.dadosCepBlock },
    to: { groupId: IDS.dadosRouteGroup, blockId: IDS.dadosRouteCond }
  });
  upsertEdge(bot, {
    id: 'edge_dados_to_resumo',
    from: { blockId: IDS.dadosRouteCond, itemId: IDS.dadosRouteToResumo },
    to: { groupId: IDS.grpResumo, blockId: IDS.clearFlagBlock }
  });
  upsertEdge(bot, {
    id: 'edge_dados_to_receita',
    from: { blockId: IDS.dadosRouteCond, itemId: IDS.dadosRouteToReceita },
    to: { groupId: IDS.grpReceita, blockId: 'blk_receita_txt' }
  });
  upsertEdge(bot, {
    id: 'edge_resumo_to_prep_dados',
    from: { blockId: IDS.choiceBlock, itemId: IDS.corrDadosItem },
    to: { groupId: IDS.prepDadosGroup, blockId: IDS.prepDadosSet }
  });
  upsertEdge(bot, {
    id: 'edge_prep_dados_to_dados',
    from: { blockId: 'blk_resumo_prep_dados_done' },
    to: { groupId: IDS.grpDados, blockId: 'emdb1ofb3knx8py3jc4ed13h' }
  });
  upsertEdge(bot, {
    id: 'edge_resumo_to_medcount',
    from: { blockId: IDS.choiceBlock, itemId: IDS.corrMedsItem },
    to: { groupId: IDS.grpMedCount, blockId: 'ng82dao2u8yp3cyr8oopz1tt' }
  });
  upsertEdge(bot, {
    id: 'edge_confirm_to_webhook',
    from: { blockId: IDS.choiceBlock, itemId: IDS.confirmItem },
    to: { groupId: 'g60uvyvi39v47j4ahnoxkxzn', blockId: 'axuwb907imxr22bqbnugj3ab' }
  });
}

function patchFile(filePath) {
  const bot = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  patchResumoDados(bot);
  fs.writeFileSync(filePath, `${JSON.stringify(bot, null, 2)}\n`);
  return filePath;
}

if (require.main === module) {
  const files = process.argv.slice(2);
  const targets = files.length
    ? files
    : [
        path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-homologado-20260716.json'),
        path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-staging-safe.json'),
        path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-production.json')
      ];
  for (const file of targets) patchFile(path.resolve(file));
  console.log('patched:', targets.join(', '));
}

module.exports = { patchResumoDados, IDS, RESUMO_JS };
