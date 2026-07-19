/**
 * Corrige o bloco Receita anterior e adiciona Data da receita anterior no Typebot.
 *
 * - Pergunta principal com 3 opções (has_previous_prescription)
 * - Roteamento: available_now / not_available_now / none
 * - Bloco Data da receita anterior (previous_prescription_age)
 * - Encerramentos e continuidade para pagamento conforme especificação
 *
 * Uso: node mdoctor-backend/scripts/patch-typebot-receita-anterior.js
 */
const fs = require('fs');
const path = require('path');

const TARGETS = [
  path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-staging-safe.json'),
  path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-homologado-20260716.json')
];

const IDS = {
  grpReceita: 'grp_receita_anterior',
  blkReceitaTxt: 'blk_receita_txt',
  blkReceitaChoice: 'blk_receita_choice',
  recAvailable: 'rec_available_now',
  recNotAvailable: 'rec_not_available_now',
  recNone: 'rec_none',
  edgeAvailable: 'edge_rec_available_now',
  edgeNotAvailable: 'edge_rec_not_available_now',
  edgeNone: 'edge_rec_none',
  grpData: 'grp_receita_data',
  blkDataTxt: 'blk_receita_data_txt',
  blkDataChoice: 'blk_receita_data_choice',
  ageWithin: 'rec_age_within_180',
  ageOver: 'rec_age_over_180',
  ageUnknown: 'rec_age_unknown',
  edgeAgeWithin: 'edge_rec_age_within_180',
  edgeAgeOver: 'edge_rec_age_over_180',
  edgeAgeUnknown: 'edge_rec_age_unknown',
  grpContinueTerms: 'grp_receita_continue_terms',
  blkContinueSetEligible: 'blk_receita_set_eligible',
  blkContinueTxt: 'blk_receita_continue_txt',
  grpContinueUnknown: 'grp_receita_continue_unknown',
  blkUnknownSetEligible: 'blk_receita_unknown_set_eligible',
  blkUnknownSetReview: 'blk_receita_unknown_set_review',
  blkUnknownTxt: 'blk_receita_unknown_txt',
  grpPendingDoc: 'grp_receita_pending_doc',
  blkPendingStatus: 'blk_receita_pending_status',
  blkPendingPhoto: 'blk_receita_pending_photo',
  blkPendingTxt: 'blk_receita_pending_txt',
  grpNone: 'grp_receita_none',
  blkNoneStatus: 'blk_receita_none_status',
  blkNoneReason: 'blk_receita_none_reason',
  blkNoneTxt: 'blk_receita_none_txt',
  grpOver180: 'grp_receita_over_180',
  blkOver180Status: 'blk_receita_over_180_status',
  blkOver180Reason: 'blk_receita_over_180_reason',
  blkOver180Txt: 'blk_receita_over_180_txt',
  edgeContinueToTerms: 'edge_receita_continue_to_terms',
  edgeUnknownToTerms: 'edge_receita_unknown_to_terms',
  varHasPrevious: 'var_p62z9hhk',
  varPhotoReady: 'var_rb0uqixe',
  varEligibility: 'var_vuymu8y8',
  varIneligibilityReason: 'var_3qdmrwpx',
  varPreviousAge: 'var_previous_prescription_age',
  varDateReview: 'var_prescription_date_requires_review',
  grpTerms: 'grp_termos_uso',
  blkTermsIntro: 'blk_terms_intro'
};

const QUESTION =
  'Você possui uma receita médica anterior, emitida para você, e consegue enviar agora uma foto legível ou um arquivo em PDF?';
const OPT_AVAILABLE = 'Sim, tenho e consigo enviar agora';
const OPT_NOT_AVAILABLE = 'Tenho a receita, mas não consigo enviar agora';
const OPT_NONE = 'Não tenho receita anterior';
const DATA_QUESTION = 'A receita anterior foi emitida há quanto tempo?';
const OPT_WITHIN = 'Há até 180 dias';
const OPT_OVER = 'Há mais de 180 dias';
const OPT_UNKNOWN = 'Não sei informar';
const MSG_PENDING =
  'Para concluir a solicitação, será necessário enviar a receita anterior.\n\nVocê poderá iniciar um novo atendimento quando estiver com a imagem ou o arquivo disponível.\n\nNenhuma cobrança foi realizada.';
const MSG_NONE =
  'A receita anterior é necessária para esta modalidade de atendimento.\n\nSem esse documento, não será possível continuar neste momento. Recomendamos avaliação médica presencial ou contato com o profissional que acompanha seu tratamento.\n\nNenhuma cobrança foi realizada.';
const MSG_OVER_180 =
  'A receita informada foi emitida há mais de 180 dias e está fora do período aceito para esta modalidade de atendimento.\n\nRecomendamos nova avaliação médica presencial.\n\nNenhuma cobrança foi realizada.';

function richParagraph(text) {
  return {
    id: `p_${Math.random().toString(36).slice(2, 10)}`,
    type: 'p',
    children: [{ text }]
  };
}

function richParagraphs(text) {
  return String(text)
    .split('\n\n')
    .filter(Boolean)
    .map((part) => richParagraph(part));
}

function ensureVariable(bot, id, name) {
  bot.variables = bot.variables || [];
  let variable = bot.variables.find((v) => v.id === id || v.name === name);
  if (!variable) {
    variable = { id, name, isSessionVariable: false };
    bot.variables.push(variable);
  }
  variable.name = name;
  return variable;
}

function upsertEdge(bot, edge) {
  bot.edges = bot.edges || [];
  const index = bot.edges.findIndex((item) => item.id === edge.id);
  if (index >= 0) bot.edges[index] = edge;
  else bot.edges.push(edge);
}

function removeEdges(bot, predicate) {
  bot.edges = (bot.edges || []).filter((edge) => !predicate(edge));
}

function upsertGroup(bot, group) {
  const index = bot.groups.findIndex((item) => item.id === group.id);
  if (index >= 0) bot.groups[index] = group;
  else bot.groups.push(group);
}

function patchReceitaAnterior(bot) {
  ensureVariable(bot, IDS.varPreviousAge, 'previous_prescription_age');
  ensureVariable(bot, IDS.varDateReview, 'prescription_date_requires_review');

  const hasPreviousVar = ensureVariable(bot, IDS.varHasPrevious, 'has_previous_prescription');
  const photoReadyVar = ensureVariable(bot, IDS.varPhotoReady, 'has_prescription_photo_ready');
  const eligibilityVar = ensureVariable(bot, IDS.varEligibility, 'eligibility_status');
  const reasonVar = ensureVariable(bot, IDS.varIneligibilityReason, 'ineligibility_reason');
  const ageVar = ensureVariable(bot, IDS.varPreviousAge, 'previous_prescription_age');
  const reviewVar = ensureVariable(bot, IDS.varDateReview, 'prescription_date_requires_review');

  upsertGroup(bot, {
    id: IDS.grpReceita,
    title: 'Receita anterior',
    graphCoordinates: { x: -2700, y: -1550 },
    blocks: [
      {
        id: IDS.blkReceitaTxt,
        type: 'text',
        content: { richText: richParagraphs(QUESTION) }
      },
      {
        id: IDS.blkReceitaChoice,
        type: 'choice input',
        items: [
          {
            id: IDS.recAvailable,
            outgoingEdgeId: IDS.edgeAvailable,
            content: OPT_AVAILABLE,
            value: 'available_now'
          },
          {
            id: IDS.recNotAvailable,
            outgoingEdgeId: IDS.edgeNotAvailable,
            content: OPT_NOT_AVAILABLE,
            value: 'not_available_now'
          },
          {
            id: IDS.recNone,
            outgoingEdgeId: IDS.edgeNone,
            content: OPT_NONE,
            value: 'none'
          }
        ],
        options: { variableId: hasPreviousVar.id }
      }
    ]
  });

  upsertGroup(bot, {
    id: IDS.grpData,
    title: 'Data da receita anterior',
    graphCoordinates: { x: -2500, y: -1400 },
    blocks: [
      {
        id: IDS.blkDataTxt,
        type: 'text',
        content: { richText: richParagraphs(DATA_QUESTION) }
      },
      {
        id: IDS.blkDataChoice,
        type: 'choice input',
        items: [
          {
            id: IDS.ageWithin,
            outgoingEdgeId: IDS.edgeAgeWithin,
            content: OPT_WITHIN,
            value: 'within_180_days'
          },
          {
            id: IDS.ageOver,
            outgoingEdgeId: IDS.edgeAgeOver,
            content: OPT_OVER,
            value: 'over_180_days'
          },
          {
            id: IDS.ageUnknown,
            outgoingEdgeId: IDS.edgeAgeUnknown,
            content: OPT_UNKNOWN,
            value: 'unknown'
          }
        ],
        options: { variableId: ageVar.id }
      }
    ]
  });

  upsertGroup(bot, {
    id: IDS.grpContinueTerms,
    title: 'Receita válida — continuar',
    graphCoordinates: { x: -2300, y: -1700 },
    blocks: [
      {
        id: IDS.blkContinueSetEligible,
        type: 'Set variable',
        options: { variableId: eligibilityVar.id, expressionToEvaluate: 'eligible' }
      },
      {
        id: IDS.blkContinueTxt,
        outgoingEdgeId: IDS.edgeContinueToTerms,
        type: 'text',
        content: {
          richText: [
            richParagraph('Triagem aprovada. Leia os termos antes do pagamento da taxa de avaliação médica.')
          ]
        }
      }
    ]
  });

  upsertGroup(bot, {
    id: IDS.grpContinueUnknown,
    title: 'Receita — data incerta',
    graphCoordinates: { x: -2300, y: -1550 },
    blocks: [
      {
        id: IDS.blkUnknownSetEligible,
        type: 'Set variable',
        options: { variableId: eligibilityVar.id, expressionToEvaluate: 'eligible' }
      },
      {
        id: IDS.blkUnknownSetReview,
        type: 'Set variable',
        options: { variableId: reviewVar.id, expressionToEvaluate: 'true' }
      },
      {
        id: IDS.blkUnknownTxt,
        outgoingEdgeId: IDS.edgeUnknownToTerms,
        type: 'text',
        content: {
          richText: [
            richParagraph('Triagem aprovada. Leia os termos antes do pagamento da taxa de avaliação médica.')
          ]
        }
      }
    ]
  });

  upsertGroup(bot, {
    id: IDS.grpPendingDoc,
    title: 'Receita indisponível agora',
    graphCoordinates: { x: -3000, y: -1250 },
    blocks: [
      {
        id: IDS.blkPendingStatus,
        type: 'Set variable',
        options: { variableId: eligibilityVar.id, expressionToEvaluate: 'pending_document' }
      },
      {
        id: IDS.blkPendingPhoto,
        type: 'Set variable',
        options: { variableId: photoReadyVar.id, expressionToEvaluate: 'false' }
      },
      {
        id: IDS.blkPendingTxt,
        type: 'text',
        content: { richText: richParagraphs(MSG_PENDING) }
      }
    ]
  });

  upsertGroup(bot, {
    id: IDS.grpNone,
    title: 'Sem receita anterior',
    graphCoordinates: { x: -3300, y: -1250 },
    blocks: [
      {
        id: IDS.blkNoneStatus,
        type: 'Set variable',
        options: { variableId: eligibilityVar.id, expressionToEvaluate: 'ineligible' }
      },
      {
        id: IDS.blkNoneReason,
        type: 'Set variable',
        options: {
          variableId: reasonVar.id,
          expressionToEvaluate: '"ausência de receita anterior"'
        }
      },
      {
        id: IDS.blkNoneTxt,
        type: 'text',
        content: { richText: richParagraphs(MSG_NONE) }
      }
    ]
  });

  upsertGroup(bot, {
    id: IDS.grpOver180,
    title: 'Receita fora do prazo',
    graphCoordinates: { x: -3000, y: -1400 },
    blocks: [
      {
        id: IDS.blkOver180Status,
        type: 'Set variable',
        options: { variableId: eligibilityVar.id, expressionToEvaluate: 'ineligible' }
      },
      {
        id: IDS.blkOver180Reason,
        type: 'Set variable',
        options: {
          variableId: reasonVar.id,
          expressionToEvaluate: '"receita anterior emitida há mais de 180 dias"'
        }
      },
      {
        id: IDS.blkOver180Txt,
        type: 'text',
        content: { richText: richParagraphs(MSG_OVER_180) }
      }
    ]
  });

  removeEdges(
    bot,
    (edge) =>
      edge.id === 'edge_rec_sim' ||
      edge.id === 'edge_rec_nao' ||
      edge.from?.blockId === IDS.blkReceitaChoice
  );

  upsertEdge(bot, {
    id: IDS.edgeAvailable,
    from: { blockId: IDS.blkReceitaChoice, itemId: IDS.recAvailable },
    to: { groupId: IDS.grpData, blockId: IDS.blkDataTxt }
  });
  upsertEdge(bot, {
    id: IDS.edgeNotAvailable,
    from: { blockId: IDS.blkReceitaChoice, itemId: IDS.recNotAvailable },
    to: { groupId: IDS.grpPendingDoc }
  });
  upsertEdge(bot, {
    id: IDS.edgeNone,
    from: { blockId: IDS.blkReceitaChoice, itemId: IDS.recNone },
    to: { groupId: IDS.grpNone }
  });
  upsertEdge(bot, {
    id: IDS.edgeAgeWithin,
    from: { blockId: IDS.blkDataChoice, itemId: IDS.ageWithin },
    to: { groupId: IDS.grpContinueTerms }
  });
  upsertEdge(bot, {
    id: IDS.edgeAgeOver,
    from: { blockId: IDS.blkDataChoice, itemId: IDS.ageOver },
    to: { groupId: IDS.grpOver180 }
  });
  upsertEdge(bot, {
    id: IDS.edgeAgeUnknown,
    from: { blockId: IDS.blkDataChoice, itemId: IDS.ageUnknown },
    to: { groupId: IDS.grpContinueUnknown }
  });
  upsertEdge(bot, {
    id: IDS.edgeContinueToTerms,
    from: { blockId: IDS.blkContinueTxt },
    to: { groupId: IDS.grpTerms, blockId: IDS.blkTermsIntro }
  });
  upsertEdge(bot, {
    id: IDS.edgeUnknownToTerms,
    from: { blockId: IDS.blkUnknownTxt },
    to: { groupId: IDS.grpTerms, blockId: IDS.blkTermsIntro }
  });

  return bot;
}

function validatePatch(bot) {
  const errors = [];
  const receita = bot.groups.find((group) => group.id === IDS.grpReceita);
  const choice = receita?.blocks.find((block) => block.id === IDS.blkReceitaChoice);
  const values = (choice?.items || []).map((item) => item.value);
  if (values.join(',') !== 'available_now,not_available_now,none') {
    errors.push('valores de has_previous_prescription incorretos');
  }

  const data = bot.groups.find((group) => group.id === IDS.grpData);
  const ageChoice = data?.blocks.find((block) => block.id === IDS.blkDataChoice);
  const ageValues = (ageChoice?.items || []).map((item) => item.value);
  if (ageValues.join(',') !== 'within_180_days,over_180_days,unknown') {
    errors.push('valores de previous_prescription_age incorretos');
  }

  for (const label of [OPT_AVAILABLE, OPT_NOT_AVAILABLE, OPT_NONE]) {
    if (!JSON.stringify(receita).includes(label)) errors.push(`opção ausente: ${label}`);
  }

  const gateEdge = bot.edges.find((edge) => edge.id === 'edge_rec_sim');
  if (gateEdge) errors.push('edge_rec_sim legado ainda presente');

  const pending = bot.groups.find((group) => group.id === IDS.grpPendingDoc);
  const pendingBlocks = JSON.stringify(pending?.blocks || []);
  if (!pendingBlocks.includes('pending_document')) errors.push('pending_document não configurado');
  if (!pendingBlocks.includes('false')) errors.push('has_prescription_photo_ready=false ausente');

  if (!bot.variables.some((variable) => variable.name === 'previous_prescription_age')) {
    errors.push('variável previous_prescription_age ausente');
  }
  if (!bot.variables.some((variable) => variable.name === 'prescription_date_requires_review')) {
    errors.push('variável prescription_date_requires_review ausente');
  }

  if (errors.length) throw new Error(errors.join('; '));
}

function main() {
  for (const file of TARGETS) {
    if (!fs.existsSync(file)) {
      console.warn('Arquivo ausente, ignorado:', file);
      continue;
    }
    const bot = patchReceitaAnterior(JSON.parse(fs.readFileSync(file, 'utf8')));
    validatePatch(bot);
    fs.writeFileSync(file, JSON.stringify(bot, null, 2) + '\n');
    console.log('Patch aplicado:', path.relative(process.cwd(), file));
  }
}

if (require.main === module) {
  main();
}

module.exports = { patchReceitaAnterior, validatePatch, IDS, OPT_AVAILABLE, OPT_NOT_AVAILABLE, OPT_NONE };
