/**
 * Reorganiza o export Typebot Doctor Prescreve (staging-safe):
 * - Elegibilidade antes do pagamento (receita + foto disponível, sem upload)
 * - Pagamento após triagem mínima, antes dos medicamentos detalhados
 * - Upload da receita obrigatório após pagamento
 * - Medicamentos 1/2/3 com variáveis próprias
 * - Webhook staging completo
 *
 * Uso: node scripts/patch-typebot-reorganize.js
 */
const fs = require('fs');
const path = require('path');
const {
  linksPayload,
  jsonForExpression,
  richLinkParagraph,
  richPlainParagraph,
  richDocumentList,
  collectBareSupabaseUrlsInTextBlocks,
  webhookConsentFields
} = require('./typebot-documents');

const targetPath = path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-staging-safe.json');
const exportMirrorPath = path.join(
  __dirname,
  '../../docs/typebot/typebot-export-doctor-prescreve-8rmljgu (5).json'
);

const STAGING_WEBHOOK = 'https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook';
const INELIGIBLE_MSG =
  'Pelas informações fornecidas, não será possível seguir com a renovação por teleconsulta neste momento. Recomendamos atendimento médico presencial para melhor avaliação.';

const WEBHOOK_BODY = `{
  "from": "{{whatsapp}}",
  "telefone": "{{whatsapp}}",
  "patient_name": "{{Nome_Completo}}",
  "birth_date": "{{data_nascimento}}",
  "cpf": "{{cpf_paciente}}",
  "whatsapp": "{{whatsapp}}",
  "email": "{{Email}}",
  "address": "{{Endereco}}",
  "cep": "{{cep}}",
  "chronic_condition": "{{doenca_cronica}}",
  "continuous_use_days": "{{continuous_use_days}}",
  "tempo_uso": "{{tempo_uso}}",
  "has_warning_signs": "{{has_warning_signs}}",
  "sinais_alerta": "{{sinais_alerta}}",
  "eligibility_status": "{{eligibility_status}}",
  "ineligibility_reason": "{{ineligibility_reason}}",
  "has_previous_prescription": "{{has_previous_prescription}}",
  "has_prescription_photo_ready": "{{has_prescription_photo_ready}}",
  "previous_prescription_file": "{{previous_prescription_file}}",
  "foto_receita_url": "{{previous_prescription_file}}",
  "medication_count": "{{medication_count}}",
  "medication_1_name": "{{med1_nome}}",
  "medication_1_dose": "{{med1_dose}}",
  "medication_1_frequency": "{{med1_frequencia}}",
  "medication_1_route": "{{med1_via}}",
  "medication_2_name": "{{med2_nome}}",
  "medication_2_dose": "{{med2_dose}}",
  "medication_2_frequency": "{{med2_frequencia}}",
  "medication_2_route": "{{med2_via}}",
  "medication_3_name": "{{med3_nome}}",
  "medication_3_dose": "{{med3_dose}}",
  "medication_3_frequency": "{{med3_frequencia}}",
  "medication_3_route": "{{med3_via}}",
  "medications": [
    { "name": "{{med1_nome}}", "dose": "{{med1_dose}}", "frequency": "{{med1_frequencia}}", "route": "{{med1_via}}" },
    { "name": "{{med2_nome}}", "dose": "{{med2_dose}}", "frequency": "{{med2_frequencia}}", "route": "{{med2_via}}" },
    { "name": "{{med3_nome}}", "dose": "{{med3_dose}}", "frequency": "{{med3_frequencia}}", "route": "{{med3_via}}" }
  ],
  "medication_name": "{{med1_nome}}",
  "medication_dose": "{{med1_dose}}",
  "medication_frequency": "{{med1_frequencia}}",
  "medication_route": "{{med1_via}}",
  "primeiro_medicamento": "{{med1_nome}} — {{med1_dose}} — {{med1_frequencia}}",
  "segundo_medicamento": "{{med2_nome}} — {{med2_dose}} — {{med2_frequencia}}",
  "terceiro_medicamento": "{{med3_nome}} — {{med3_dose}} — {{med3_frequencia}}",
  "payment_status": "paid",
  "pagamento_status": "CONFIRMADO",
  "pagamento": "pago",
  "protocol": "staging-clinical-v1",
  "source": "typebot-doctor-prescreve",
  "nome": "{{Nome_Completo}}",
  "doenca_cronica": "{{doenca_cronica}}",
  "text": "Triagem Doctor Prescreve — {{Nome_Completo}} — {{doenca_cronica}} — {{med1_nome}}",
  ${webhookConsentFields().trim()}
}`;

const IDS = {
  dadosEndereco: 'q78qjnk6ticw',
  medCountChoice: 'w97ho902ina4lg7b6dn0sycw',
  medCount1: 'l6ckgiezhwfz71q9ghzbr60o',
  medCount2: 'a3tft76xm1j35grku3wi2wcr',
  medCount3: 'tcxyvudqg1en4j05s0bby66i',
  paymentBlock: 'rapfykn1f1uno89ypqmwi43f',
  paymentEdge: 'xxpw9p5hptmv7u7qlatptirp',
  confirmChoice: 'plhspmybxbhylbfbsvqyhlmj',
  confirmItem: 'nmhyrnorx68pd9jrp98esvli',
  elegivelText: 'xus8mt3l0wv32b84gv9tkihm',
  webhookBlock: 'axuwb907imxr22bqbnugj3ab',
  webhookEdge: 'vgmrhkywl7kagoaeaq2ybdmg',
  grpMedCount: 'huh6fmizvv701t9u7hc2mult',
  grpMed1: 'w1hv8mud',
  grpMed2: 'o1xsvn2j',
  grpMed3: 'iaurdgxv',
  grpFoto: 'grp_foto_receita',
  grpReceita: 'grp_receita_anterior',
  grpGate: 'grp_gate_pagamento',
  grpIneligible: 'grp_inelegivel_presencial',
  grpRouteAfterMed1: 'grp_route_after_med1',
  grpRouteAfterMed2: 'grp_route_after_med2',
  grpLgpd: 'b2l6ks9gkl95zebue3wri6tr',
  lgpdChoice: 'ivbr3o1a7lv8izhfteuerhqx',
  lgpdAutorizo: 'rx2ibesgrkoewo6gw5ah1d16',
  lgpdNao: 'pco3gbkf4qv9250dxhdrgpo4',
  grpLgpdAccept: 'grp_lgpd_accept',
  grpTelemedicine: 'grp_telemedicina_consent',
  grpTelemedicineAccept: 'grp_telemedicina_accept',
  grpTeleDecline: 'grp_telemedicina_decline',
  grpTerms: 'grp_termos_uso',
  grpTermsAccept: 'grp_termos_accept',
  sinaisToTelemed: 'o51d9l56lzldmzcuvc0jdg6y',
  declaracao: 'fni2p22kfg51hs6s6lhcteec',
  nomeSocial: 'mulxehkw'
};

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function findGroup(bot, titlePart) {
  return bot.groups.find((g) => String(g.title || '').toLowerCase().includes(titlePart.toLowerCase()));
}

function findGroupByIdPrefix(bot, prefix) {
  return bot.groups.find((g) => String(g.id || '').startsWith(prefix));
}

function ensureVariable(bot, name) {
  let v = bot.variables.find((x) => x.name === name);
  if (!v) {
    v = { id: uid('var'), name, isSessionVariable: false };
    bot.variables.push(v);
  }
  return v;
}

function removeEdges(bot, ids) {
  const set = new Set(ids);
  bot.edges = bot.edges.filter((e) => !set.has(e.id));
}

function upsertEdge(bot, edge) {
  bot.edges = bot.edges.filter((e) => e.id !== edge.id);
  bot.edges.push(edge);
}

function richParagraph(text) {
  return { id: uid('p'), type: 'p', children: [{ text }] };
}

function buildMedicationGroup(title, graphCoordinates, fields) {
  const blocks = [
    {
      id: uid('blk'),
      type: 'text',
      content: { richText: [richParagraph(title)] }
    }
  ];
  fields.forEach((field) => {
    if (field.type === 'choice') {
      blocks.push({
        id: uid('blk'),
        type: 'choice input',
        items: field.items.map((label) => ({ id: uid('it'), content: label })),
        options: { variableId: field.variableId }
      });
    } else {
      blocks.push({
        id: uid('blk'),
        type: 'text input',
        options: {
          labels: { placeholder: field.placeholder, button: 'Enviar' },
          variableId: field.variableId
        }
      });
    }
  });
  return { blocks, lastBlockId: blocks[blocks.length - 1].id };
}

function patchVariables(bot) {
  const names = [
    'cep',
    'medication_count',
    'med1_nome',
    'med1_dose',
    'med1_frequencia',
    'med1_via',
    'med2_nome',
    'med2_dose',
    'med2_frequencia',
    'med2_via',
    'med3_nome',
    'med3_dose',
    'med3_frequencia',
    'med3_via',
    'has_previous_prescription',
    'has_prescription_photo_ready',
    'previous_prescription_file',
    'foto_receita_url',
    'has_warning_signs',
    'eligibility_status',
    'ineligibility_reason',
    'continuous_use_days',
    'payment_status',
    'lgpd_accepted',
    'privacy_policy_accepted',
    'telemedicine_consent_accepted',
    'non_urgency_notice_accepted',
    'terms_of_use_accepted',
    'accepted_terms_at',
    'accepted_terms_links',
    'terms_accepted_summary'
  ];
  names.forEach((n) => ensureVariable(bot, n));
}

function setVarBlock(id, variableName, expression, bot) {
  return {
    id,
    type: 'Set variable',
    options: {
      variableId: ensureVariable(bot, variableName).id,
      expressionToEvaluate: expression
    }
  };
}

function patchLgpdGroup(bot) {
  const g = bot.groups.find((x) => x.id === IDS.grpLgpd) || findGroup(bot, 'Consentimento LGPD');
  if (!g) return;
  g.blocks = [
    {
      id: 'blk_lgpd_intro',
      type: 'text',
      content: {
        richText: [richPlainParagraph('Antes de continuar, leia os documentos abaixo:', uid)]
      }
    },
    {
      id: 'blk_lgpd_docs',
      type: 'text',
      content: {
        richText: richDocumentList(['lgpd', 'privacy'], uid)
      }
    },
    {
      id: 'blk_lgpd_auth',
      type: 'text',
      content: {
        richText: [
          richPlainParagraph(
            'Ao continuar, você autoriza o tratamento dos seus dados pessoais e de saúde para fins de triagem, atendimento, prontuário e emissão de receita digital.',
            uid
          )
        ]
      }
    },
    {
      id: IDS.lgpdChoice,
      type: 'choice input',
      items: [
        { id: IDS.lgpdAutorizo, outgoingEdgeId: 'edge_lgpd_to_accept', content: 'Autorizo', value: 'sim' },
        { id: IDS.lgpdNao, outgoingEdgeId: 'edge_lgpd_to_decline', content: 'Não autorizo', value: 'nao' }
      ],
      options: { variableId: ensureVariable(bot, 'lgpd_accepted').id }
    }
  ];
}

function patchLgpdAcceptGroup(bot) {
  const links = jsonForExpression(linksPayload(['lgpd', 'privacy']));
  let g = bot.groups.find((x) => x.id === IDS.grpLgpdAccept);
  if (!g) {
    g = {
      id: IDS.grpLgpdAccept,
      title: 'Registro LGPD',
      graphCoordinates: { x: -4500, y: -2400 },
      blocks: []
    };
    bot.groups.push(g);
  }
  g.blocks = [
    setVarBlock('blk_set_lgpd', 'lgpd_accepted', 'true', bot),
    setVarBlock('blk_set_privacy', 'privacy_policy_accepted', 'true', bot),
    setVarBlock('blk_set_lgpd_links', 'accepted_terms_links', `"${links}"`, bot),
    {
      id: 'blk_lgpd_accept_done',
      outgoingEdgeId: 'edge_lgpd_accept_to_nome',
      type: 'text',
      content: { richText: [richPlainParagraph('Obrigado. Vamos continuar.', uid)] }
    }
  ];
}

function patchTelemedicineGroup(bot) {
  let g = bot.groups.find((x) => x.id === IDS.grpTelemedicine);
  if (!g) {
    g = {
      id: IDS.grpTelemedicine,
      title: 'Telemedicina e não urgência',
      graphCoordinates: { x: -3600, y: -2000 },
      blocks: []
    };
    bot.groups.push(g);
  }
  g.blocks = [
    {
      id: 'blk_tele_intro',
      type: 'text',
      content: {
        richText: [
          richPlainParagraph(
            'Este atendimento é uma teleconsulta assíncrona para avaliação de renovação de receita. Não substitui atendimento presencial em casos de urgência ou emergência.',
            uid
          )
        ]
      }
    },
    {
      id: 'blk_tele_docs',
      type: 'text',
      content: {
        richText: richDocumentList(['telemedicine', 'nonUrgency'], uid)
      }
    },
    {
      id: 'blk_tele_choice',
      type: 'choice input',
      items: [
        {
          id: 'tele_sim',
          outgoingEdgeId: 'edge_tele_to_accept',
          content: 'Estou ciente e desejo continuar',
          value: 'sim'
        },
        {
          id: 'tele_nao',
          outgoingEdgeId: 'edge_tele_to_decline',
          content: 'Não desejo continuar',
          value: 'nao'
        }
      ],
      options: { variableId: ensureVariable(bot, 'telemedicine_consent_accepted').id }
    }
  ];
}

function patchTelemedicineAcceptGroup(bot) {
  const links = jsonForExpression(linksPayload(['lgpd', 'privacy', 'telemedicine', 'nonUrgency']));
  let g = bot.groups.find((x) => x.id === IDS.grpTelemedicineAccept);
  if (!g) {
    g = {
      id: IDS.grpTelemedicineAccept,
      title: 'Registro telemedicina',
      graphCoordinates: { x: -3500, y: -1950 },
      blocks: []
    };
    bot.groups.push(g);
  }
  g.blocks = [
    setVarBlock('blk_set_tele', 'telemedicine_consent_accepted', 'true', bot),
    setVarBlock('blk_set_nonurgency', 'non_urgency_notice_accepted', 'true', bot),
    setVarBlock('blk_set_tele_links', 'accepted_terms_links', `"${links}"`, bot),
    {
      id: 'blk_tele_accept_done',
      outgoingEdgeId: 'edge_tele_accept_to_declaracao',
      type: 'text',
      content: { richText: [richPlainParagraph('Prosseguindo com a triagem.', uid)] }
    }
  ];
}

function patchTelemedicineDeclineGroup(bot) {
  let g = bot.groups.find((x) => x.id === IDS.grpTeleDecline);
  if (!g) {
    g = {
      id: IDS.grpTeleDecline,
      title: 'Encerramento telemedicina',
      graphCoordinates: { x: -3500, y: -1800 },
      blocks: []
    };
    bot.groups.push(g);
  }
  g.blocks = [
    {
      id: 'blk_tele_decline_txt',
      type: 'text',
      content: {
        richText: [
          richPlainParagraph('Atendimento encerrado a seu pedido.', uid),
          richPlainParagraph(
            'Se precisar de ajuda em urgência ou emergência, procure um serviço presencial imediatamente.',
            uid
          )
        ]
      }
    }
  ];
}

function patchTermsGroup(bot) {
  let g = bot.groups.find((x) => x.id === IDS.grpTerms);
  if (!g) {
    g = {
      id: IDS.grpTerms,
      title: 'Termos de uso',
      graphCoordinates: { x: -2900, y: -1750 },
      blocks: []
    };
    bot.groups.push(g);
  }
  g.blocks = [
    {
      id: 'blk_terms_intro',
      type: 'text',
      content: {
        richText: [
          richPlainParagraph(
            'Antes de realizar o pagamento, leia e aceite os termos de uso do Doctor Prescreve.',
            uid
          )
        ]
      }
    },
    {
      id: 'blk_terms_doc',
      type: 'text',
      content: {
        richText: richDocumentList(['termsOfUse'], uid)
      }
    },
    {
      id: 'blk_terms_choice',
      type: 'choice input',
      items: [
        {
          id: 'terms_agree',
          outgoingEdgeId: 'edge_terms_to_accept',
          content: 'Li e concordo com os termos',
          value: 'sim'
        }
      ],
      options: { variableId: ensureVariable(bot, 'terms_of_use_accepted').id }
    }
  ];
}

function patchTermsAcceptGroup(bot) {
  const links = jsonForExpression(
    linksPayload(['lgpd', 'privacy', 'telemedicine', 'nonUrgency', 'termsOfUse'])
  );
  const summary = jsonForExpression({
    lgpd: true,
    privacy: true,
    telemedicine: true,
    non_urgency: true,
    terms_of_use: true
  });
  let g = bot.groups.find((x) => x.id === IDS.grpTermsAccept);
  if (!g) {
    g = {
      id: IDS.grpTermsAccept,
      title: 'Registro termos',
      graphCoordinates: { x: -2850, y: -1700 },
      blocks: []
    };
    bot.groups.push(g);
  }
  g.blocks = [
    setVarBlock('blk_set_terms', 'terms_of_use_accepted', 'true', bot),
    setVarBlock('blk_set_terms_at', 'accepted_terms_at', '{{now}}', bot),
    setVarBlock('blk_set_terms_links', 'accepted_terms_links', `"${links}"`, bot),
    setVarBlock('blk_set_terms_summary', 'terms_accepted_summary', `"${summary}"`, bot),
    {
      id: 'blk_terms_accept_done',
      outgoingEdgeId: 'edge_terms_accept_to_payment',
      type: 'text',
      content: {
        richText: [richPlainParagraph('Termos aceitos. Você será direcionado ao pagamento.', uid)]
      }
    }
  ];
}

function patchDadosPessoais(bot) {
  const dados = findGroup(bot, 'Dados Pessoais');
  if (!dados) return;
  const cepVar = ensureVariable(bot, 'cep');
  const hasCep = dados.blocks.some(
    (b) => b.options?.variableId && bot.variables.find((v) => v.id === b.options.variableId)?.name === 'cep'
  );
  if (!hasCep) {
    dados.blocks.splice(dados.blocks.length - 1, 0, {
      id: uid('blk'),
      type: 'text input',
      options: {
        labels: { placeholder: 'CEP (somente números)', button: 'Enviar' },
        variableId: cepVar.id,
        inputMode: 'numeric'
      }
    });
  }
  const birthBlock = dados.blocks.find(
    (b) => bot.variables.find((v) => v.id === b.options?.variableId)?.name === 'data_nascimento'
  );
  if (birthBlock?.options) {
    birthBlock.options.labels = birthBlock.options.labels || {};
    birthBlock.options.labels.placeholder = 'Nascimento (dd/mm/aaaa ou 8 dígitos)';
    birthBlock.options.retryMessageContent =
      'Data inválida. Use dd/mm/aaaa, ddmmaaaa ou dd-mm-aaaa (ex.: 31/12/1980).';
  }
  const endBlock = dados.blocks.find((b) => b.id === IDS.dadosEndereco);
  if (endBlock) delete endBlock.outgoingEdgeId;
}

function patchIneligibleTexts(bot) {
  for (const title of ['Nao elegivel', 'Inelegível presencial', 'Sinal  alerta', 'Tratamento Menor']) {
    const g = findGroup(bot, title);
    if (!g) continue;
    const textBlock = g.blocks.find((b) => b.type === 'text');
    if (textBlock?.content?.richText) {
      textBlock.content.richText = [
        richParagraph('Não foi possível continuar com a renovação por teleconsulta.'),
        richParagraph(INELIGIBLE_MSG)
      ];
    }
  }
}

function patchReceitaConfirmacao(bot) {
  const recVar = ensureVariable(bot, 'has_previous_prescription');
  let g = bot.groups.find((x) => x.id === IDS.grpReceita);
  if (!g) {
    g = {
      id: IDS.grpReceita,
      title: 'Receita anterior',
      graphCoordinates: { x: -2700, y: -1550 },
      blocks: []
    };
    bot.groups.push(g);
  }
  g.title = 'Receita anterior';
  g.blocks = [
    {
      id: 'blk_receita_txt',
      type: 'text',
      content: {
        richText: [
          richParagraph(
            'Você possui uma receita médica anterior e a foto dela disponível para envio agora pelo WhatsApp?'
          )
        ]
      }
    },
    {
      id: 'blk_receita_choice',
      type: 'choice input',
      items: [
        { id: 'rec_sim', outgoingEdgeId: 'edge_rec_sim', content: 'Sim, tenho a receita e a foto', value: 'sim' },
        { id: 'rec_nao', outgoingEdgeId: 'edge_rec_nao', content: 'Não', value: 'nao' }
      ],
      options: { variableId: recVar.id }
    }
  ];
}

function patchFotoUpload(bot) {
  const fileVar = ensureVariable(bot, 'previous_prescription_file');
  ensureVariable(bot, 'foto_receita_url');
  let g = bot.groups.find((x) => x.id === IDS.grpFoto);
  if (!g) {
    g = {
      id: IDS.grpFoto,
      title: 'ENVIO DA RECEITA ANTERIOR',
      graphCoordinates: { x: -2200, y: -1200 },
      blocks: []
    };
    bot.groups.push(g);
  }
  g.title = 'ENVIO DA RECEITA ANTERIOR';
  g.blocks = [
    {
      id: 'blk_foto_txt',
      type: 'text',
      content: {
        richText: [
          richParagraph('Pagamento confirmado.'),
          richParagraph('Envie agora a foto legível da receita anterior (obrigatório).')
        ]
      }
    },
    {
      id: 'blk_foto_file',
      outgoingEdgeId: 'edge_foto_to_confirm',
      type: 'file input',
      options: {
        variableId: fileVar.id,
        labels: { placeholder: 'Toque para enviar a foto', button: 'Enviar foto' },
        required: true,
        allowedFileTypes: { isEnabled: true, types: ['image'] }
      }
    }
  ];
}

function patchGatePagamento(bot) {
  const eligVar = ensureVariable(bot, 'eligibility_status');
  let g = bot.groups.find((x) => x.id === IDS.grpGate);
  if (!g) {
    g = {
      id: IDS.grpGate,
      title: 'Gate elegível pagamento',
      graphCoordinates: { x: -3000, y: -1850 },
      blocks: []
    };
    bot.groups.push(g);
  }
  const photoReadyVar = ensureVariable(bot, 'has_prescription_photo_ready');
  g.blocks = [
    {
      id: 'blk_gate_set',
      type: 'Set variable',
      options: { variableId: eligVar.id, expressionToEvaluate: 'eligible' }
    },
    {
      id: 'blk_gate_photo_ready',
      type: 'Set variable',
      options: { variableId: photoReadyVar.id, expressionToEvaluate: 'sim' }
    },
    {
      id: 'blk_gate_txt',
      outgoingEdgeId: 'edge_gate_to_terms',
      type: 'text',
      content: {
        richText: [richParagraph('Triagem aprovada. Leia os termos antes do pagamento da taxa de avaliação médica.')]
      }
    }
  ];
}

function patchIneligibleGroup(bot) {
  const eligVar = ensureVariable(bot, 'eligibility_status');
  const reasonVar = ensureVariable(bot, 'ineligibility_reason');
  let g = bot.groups.find((x) => x.id === IDS.grpIneligible);
  if (!g) {
    g = {
      id: IDS.grpIneligible,
      title: 'Inelegível presencial',
      graphCoordinates: { x: -3300, y: -1100 },
      blocks: []
    };
    bot.groups.push(g);
  }
  g.blocks = [
    {
      id: 'blk_inel_set_status',
      type: 'Set variable',
      options: { variableId: eligVar.id, expressionToEvaluate: 'ineligible' }
    },
    {
      id: 'blk_inel_set_reason',
      type: 'Set variable',
      options: {
        variableId: reasonVar.id,
        expressionToEvaluate: '"Sem receita anterior ou foto disponível para envio."'
      }
    },
    {
      id: 'blk_inel_txt',
      type: 'text',
      content: { richText: [richParagraph(INELIGIBLE_MSG)] }
    }
  ];
}

function patchMedicationGroups(bot) {
  const v = (n) => ensureVariable(bot, n).id;
  const freqItems = ['1x ao dia', '2x ao dia', '3x ao dia', 'Conforme receita anterior'];
  const routeItems = [
    { content: 'Via oral', value: 'oral' },
    { content: 'Outra via', value: 'outra' }
  ];

  const med1 = findGroupByIdPrefix(bot, IDS.grpMed1) || findGroup(bot, 'Medicamento 1');
  if (med1) {
    const built = buildMedicationGroup('Medicamento 1 de {{medication_count}} — informe:', { x: 0, y: 0 }, [
      { placeholder: 'Nome do medicamento', variableId: v('med1_nome') },
      { placeholder: 'Dose (ex.: 50 mg)', variableId: v('med1_dose') },
      { type: 'choice', items: freqItems, variableId: v('med1_frequencia') },
      { type: 'choice', items: routeItems.map((r) => r.content), variableId: v('med1_via') }
    ]);
    built.blocks[built.blocks.length - 1].outgoingEdgeId = 'edge_med1_to_route';
    med1.blocks = built.blocks;
    med1.title = 'Medicamento 1';
  }

  const med2 = findGroupByIdPrefix(bot, IDS.grpMed2) || findGroup(bot, 'Medicamento 2');
  if (med2) {
    const built = buildMedicationGroup('Medicamento 2 de {{medication_count}} — informe:', { x: 0, y: 0 }, [
      { placeholder: 'Nome do medicamento', variableId: v('med2_nome') },
      { placeholder: 'Dose (ex.: 50 mg)', variableId: v('med2_dose') },
      { type: 'choice', items: freqItems, variableId: v('med2_frequencia') },
      { type: 'choice', items: routeItems.map((r) => r.content), variableId: v('med2_via') }
    ]);
    built.blocks[built.blocks.length - 1].outgoingEdgeId = 'edge_med2_to_route';
    med2.blocks = built.blocks;
    med2.title = 'Medicamento 2';
  }

  const med3 = findGroupByIdPrefix(bot, IDS.grpMed3) || findGroup(bot, 'Medicamento 3');
  if (med3) {
    const built = buildMedicationGroup('Medicamento 3 de {{medication_count}} — informe:', { x: 0, y: 0 }, [
      { placeholder: 'Nome do medicamento', variableId: v('med3_nome') },
      { placeholder: 'Dose (ex.: 50 mg)', variableId: v('med3_dose') },
      { type: 'choice', items: freqItems, variableId: v('med3_frequencia') },
      { type: 'choice', items: routeItems.map((r) => r.content), variableId: v('med3_via') }
    ]);
    built.blocks[built.blocks.length - 1].outgoingEdgeId = 'edge_med3_to_foto';
    med3.blocks = built.blocks;
    med3.title = 'Medicamento 3';
  }
}

function patchMedCountGroup(bot) {
  const g = bot.groups.find((x) => x.id === IDS.grpMedCount) || findGroup(bot, 'Quantas');
  if (!g) return;
  g.title = 'Quantidade de medicamentos';
  const countVar = ensureVariable(bot, 'medication_count');
  const txt = g.blocks.find((b) => b.type === 'text');
  if (txt?.content?.richText) {
    txt.content.richText = [
      richParagraph('Quantos medicamentos você deseja submeter à avaliação médica?'),
      richParagraph('São permitidos até três medicamentos.')
    ];
  }
  const choice = g.blocks.find((b) => b.type === 'choice input');
  if (choice) {
    choice.options = choice.options || {};
    choice.options.variableId = countVar.id;
    choice.items = [
      { id: IDS.medCount1, content: '1 medicamento', value: '1' },
      { id: IDS.medCount2, content: '2 medicamentos', value: '2' },
      { id: IDS.medCount3, content: '3 medicamentos', value: '3' }
    ];
    choice.items.forEach((it) => {
      it.outgoingEdgeId = 'edge_medcount_to_med1';
    });
  }
}

function ensureRouteGroups(bot) {
  const countVar = ensureVariable(bot, 'medication_count');
  const med1 = findGroupByIdPrefix(bot, IDS.grpMed1);
  const med2 = findGroupByIdPrefix(bot, IDS.grpMed2);
  const med3 = findGroupByIdPrefix(bot, IDS.grpMed3);

  function conditionGroup(id, title, y, branches) {
    let g = bot.groups.find((x) => x.id === id);
    if (!g) {
      g = { id, title, graphCoordinates: { x: -2400, y }, blocks: [] };
      bot.groups.push(g);
    }
    g.title = title;
    g.blocks = [
      {
        id: `${id}_cond`,
        type: 'Condition',
        items: branches.map((br) => ({
          id: br.itemId || uid('cond_item'),
          outgoingEdgeId: br.edgeId,
          content: {
            comparisons: [
              {
                id: uid('cmp'),
                variableId: countVar.id,
                comparisonOperator: br.operator || 'Equal to',
                value: br.value
              }
            ]
          }
        }))
      }
    ];
    return g;
  }

  conditionGroup(IDS.grpRouteAfterMed1, 'Rota após medicamento 1', -1300, [
    { itemId: 'cond_med1_eq_1', edgeId: 'edge_route_med1_is_1', value: '"1"', operator: 'Equal to' },
    { itemId: 'cond_med1_eq_2', edgeId: 'edge_route_med1_to_med2', value: '"2"', operator: 'Equal to' },
    { itemId: 'cond_med1_eq_3', edgeId: 'edge_route_med1_is_3', value: '"3"', operator: 'Equal to' }
  ]);

  conditionGroup(IDS.grpRouteAfterMed2, 'Rota após medicamento 2', -1150, [
    { itemId: 'cond_med2_eq_2', edgeId: 'edge_route_med2_is_2', value: '"2"', operator: 'Equal to' },
    { itemId: 'cond_med2_eq_3', edgeId: 'edge_route_med2_to_med3', value: '"3"', operator: 'Equal to' }
  ]);

  return { med1, med2, med3 };
}

function patchSinaisAlerta(bot) {
  const sinais = findGroup(bot, 'Sinais de Alerta');
  const sinaisChoice = sinais?.blocks?.find((b) => b.type === 'choice input');
  if (!sinaisChoice) return;
  sinaisChoice.options = sinaisChoice.options || {};
  sinaisChoice.options.isMultipleChoice = true;
  sinaisChoice.items = [
    { id: uid('it'), content: 'Dor no peito', value: 'dor_peito' },
    { id: uid('it'), content: 'Falta de ar', value: 'falta_ar' },
    { id: uid('it'), content: 'Desmaio', value: 'desmaio' },
    { id: uid('it'), content: 'Febre alta persistente', value: 'febre' },
    { id: uid('it'), content: 'Sangramento', value: 'sangramento' },
    { id: uid('it'), content: 'Nenhum destes', value: 'NAO' }
  ];
}

function patchWebhook(bot) {
  const webhookGroup = bot.groups.find((g) => g.blocks?.some((b) => b.type === 'Webhook'));
  const webhookBlock = webhookGroup?.blocks?.find((b) => b.type === 'Webhook');
  if (!webhookBlock?.options?.webhook) return;
  webhookBlock.options.webhook.body = WEBHOOK_BODY;
  webhookBlock.options.webhook.url = STAGING_WEBHOOK;
  webhookBlock.options.webhook.headers = [
    { id: webhookBlock.options.webhook.headers?.[0]?.id || uid('hdr'), key: 'Content-Type', value: 'application/json' }
  ];
  const serialized = JSON.stringify(bot);
  for (const bad of ['n8n-node-production', 'web-production', 'typebot-production']) {
    if (serialized.includes(bad)) throw new Error(`Production URL fragment found: ${bad}`);
  }
}

function patchConfirmacao(bot) {
  const g = findGroup(bot, 'Confirmação de dados');
  const txt = g?.blocks?.find((b) => b.type === 'text');
  if (txt?.content?.richText) {
    txt.content.richText = [
      richParagraph('Revise os dados informados.'),
      richParagraph('Confirma que estão corretos para envio à avaliação médica?')
    ];
  }
}

function patchFinalMessage(bot) {
  const g23 = findGroup(bot, 'Group #23');
  const txt = g23?.blocks?.find((b) => b.type === 'text');
  if (txt?.content?.richText) {
    txt.content.richText = [
      richParagraph('Recebemos suas informações e a foto da receita.'),
      richParagraph('Um médico irá analisar seu caso em breve. Você será avisado por este WhatsApp.')
    ];
  }
}

function rewireEdges(bot) {
  const dados = findGroup(bot, 'Dados Pessoais');
  const pagamento = findGroup(bot, 'Pagamento');
  const med1 = findGroupByIdPrefix(bot, IDS.grpMed1);
  const med2 = findGroupByIdPrefix(bot, IDS.grpMed2);
  const med3 = findGroupByIdPrefix(bot, IDS.grpMed3);
  const webhookGroup = bot.groups.find((g) => g.blocks?.some((b) => b.type === 'Webhook'));
  const confirmacao = findGroup(bot, 'Confirmação de dados');
  const g23 = findGroup(bot, 'Group #23');

  removeEdges(bot, [
    'g261wwhfcfbx63z22taik9uz',
    'qdbm3l4g51y98mq9cyysegzw',
    'edge_confirm_to_gate',
    'edge_hypw5tzc',
    'edge_foto_ok',
    'b0xx8xgpeppttigdubv0bm9a',
    'dfdw7exk4j7d1jyr333lfrpr',
    'n1rlsguzccjavvctcico7u9d',
    'a3tft76xm1j35grku3wi2wcr',
    'tcxyvudqg1en4j05s0bby66i',
    'l6ckgiezhwfz71q9ghzbr60o',
    'uk1utwe1dzfxi6g24hdgupq9',
    'k37624a35d94phhckzbp999y',
    'yrcn9y2vs3yplkp56py4b95p',
    'nsz746ey8snaww7jrdqrj29o',
    'epd0uir0ggbvfizfm7u4dww8',
    'o51d9l56lzldmzcuvc0jdg6y',
    'edge_gate_to_payment'
  ]);

  upsertEdge(bot, {
    id: 'edge_elegivel_to_dados',
    from: { blockId: IDS.elegivelText },
    to: { groupId: dados?.id }
  });

  upsertEdge(bot, {
    id: 'edge_dados_to_receita',
    from: { blockId: IDS.dadosEndereco },
    to: { groupId: IDS.grpReceita }
  });

  upsertEdge(bot, {
    id: 'edge_rec_sim',
    from: { blockId: 'blk_receita_choice', itemId: 'rec_sim' },
    to: { groupId: IDS.grpGate, blockId: 'blk_gate_set' }
  });

  upsertEdge(bot, {
    id: 'edge_rec_nao',
    from: { blockId: 'blk_receita_choice', itemId: 'rec_nao' },
    to: { groupId: IDS.grpIneligible }
  });

  const nomeSocial = findGroup(bot, 'Nome social');

  upsertEdge(bot, {
    id: 'edge_lgpd_to_accept',
    from: { blockId: IDS.lgpdChoice, itemId: IDS.lgpdAutorizo },
    to: { groupId: IDS.grpLgpdAccept, blockId: 'blk_set_lgpd' }
  });
  upsertEdge(bot, {
    id: 'edge_lgpd_to_decline',
    from: { blockId: IDS.lgpdChoice, itemId: IDS.lgpdNao },
    to: { groupId: findGroup(bot, 'Group #22')?.id }
  });
  upsertEdge(bot, {
    id: 'edge_lgpd_accept_to_nome',
    from: { blockId: 'blk_lgpd_accept_done' },
    to: { groupId: nomeSocial?.id || IDS.nomeSocial }
  });

  upsertEdge(bot, {
    id: 'edge_sinais_to_telemedicine',
    from: { blockId: 'm8z8uqbq019x172jv0hev99r', itemId: 'a9scc91xjc7798d5pc0jxjc6' },
    to: { groupId: IDS.grpTelemedicine, blockId: 'blk_tele_intro' }
  });
  upsertEdge(bot, {
    id: 'edge_tele_to_accept',
    from: { blockId: 'blk_tele_choice', itemId: 'tele_sim' },
    to: { groupId: IDS.grpTelemedicineAccept, blockId: 'blk_set_tele' }
  });
  upsertEdge(bot, {
    id: 'edge_tele_to_decline',
    from: { blockId: 'blk_tele_choice', itemId: 'tele_nao' },
    to: { groupId: IDS.grpTeleDecline }
  });
  upsertEdge(bot, {
    id: 'edge_tele_accept_to_declaracao',
    from: { blockId: 'blk_tele_accept_done' },
    to: { groupId: IDS.declaracao, blockId: 'iw6zqwf26frmqnp1csxiwlbm' }
  });

  upsertEdge(bot, {
    id: 'edge_gate_to_terms',
    from: { blockId: 'blk_gate_txt' },
    to: { groupId: IDS.grpTerms, blockId: 'blk_terms_intro' }
  });
  upsertEdge(bot, {
    id: 'edge_terms_to_accept',
    from: { blockId: 'blk_terms_choice', itemId: 'terms_agree' },
    to: { groupId: IDS.grpTermsAccept, blockId: 'blk_set_terms' }
  });
  upsertEdge(bot, {
    id: 'edge_terms_accept_to_payment',
    from: { blockId: 'blk_terms_accept_done' },
    to: { groupId: pagamento?.id, blockId: IDS.paymentBlock }
  });

  upsertEdge(bot, {
    id: IDS.paymentEdge,
    from: { blockId: IDS.paymentBlock },
    to: { groupId: IDS.grpMedCount }
  });

  upsertEdge(bot, {
    id: 'edge_medcount_to_med1',
    from: { blockId: IDS.medCountChoice, itemId: IDS.medCount1 },
    to: { groupId: med1?.id }
  });
  upsertEdge(bot, {
    id: 'edge_medcount_to_med1_b',
    from: { blockId: IDS.medCountChoice, itemId: IDS.medCount2 },
    to: { groupId: med1?.id }
  });
  upsertEdge(bot, {
    id: 'edge_medcount_to_med1_c',
    from: { blockId: IDS.medCountChoice, itemId: IDS.medCount3 },
    to: { groupId: med1?.id }
  });

  const med1Last = med1?.blocks?.[med1.blocks.length - 1];
  upsertEdge(bot, {
    id: 'edge_med1_to_route',
    from: { blockId: med1Last?.id },
    to: { groupId: IDS.grpRouteAfterMed1, blockId: `${IDS.grpRouteAfterMed1}_cond` }
  });

  const route1 = bot.groups.find((g) => g.id === IDS.grpRouteAfterMed1);
  const cond1 = route1?.blocks?.[0];
  if (cond1?.items?.length >= 2) {
    upsertEdge(bot, {
      id: 'edge_route_med1_is_1',
      from: { blockId: cond1.id, itemId: 'cond_med1_eq_1' },
      to: { groupId: IDS.grpFoto }
    });
    upsertEdge(bot, {
      id: 'edge_route_med1_to_med2',
      from: { blockId: cond1.id, itemId: 'cond_med1_eq_2' },
      to: { groupId: med2?.id }
    });
    upsertEdge(bot, {
      id: 'edge_route_med1_is_3',
      from: { blockId: cond1.id, itemId: 'cond_med1_eq_3' },
      to: { groupId: med2?.id }
    });
  }

  const med2Last = med2?.blocks?.[med2.blocks.length - 1];
  upsertEdge(bot, {
    id: 'edge_med2_to_route',
    from: { blockId: med2Last?.id },
    to: { groupId: IDS.grpRouteAfterMed2, blockId: `${IDS.grpRouteAfterMed2}_cond` }
  });

  const route2 = bot.groups.find((g) => g.id === IDS.grpRouteAfterMed2);
  const cond2 = route2?.blocks?.[0];
  if (cond2?.items?.length >= 2) {
    upsertEdge(bot, {
      id: 'edge_route_med2_is_2',
      from: { blockId: cond2.id, itemId: 'cond_med2_eq_2' },
      to: { groupId: IDS.grpFoto }
    });
    upsertEdge(bot, {
      id: 'edge_route_med2_to_med3',
      from: { blockId: cond2.id, itemId: 'cond_med2_eq_3' },
      to: { groupId: med3?.id }
    });
  }

  const med3Last = med3?.blocks?.[med3.blocks.length - 1];
  upsertEdge(bot, {
    id: 'edge_med3_to_foto',
    from: { blockId: med3Last?.id },
    to: { groupId: IDS.grpFoto }
  });

  upsertEdge(bot, {
    id: 'edge_foto_to_confirm',
    from: { blockId: 'blk_foto_file' },
    to: { groupId: confirmacao?.id }
  });

  upsertEdge(bot, {
    id: 'edge_confirm_to_webhook',
    from: { blockId: IDS.confirmChoice, itemId: IDS.confirmItem },
    to: { groupId: webhookGroup?.id, blockId: IDS.webhookBlock }
  });

  upsertEdge(bot, {
    id: IDS.webhookEdge,
    from: { blockId: IDS.webhookBlock },
    to: { groupId: g23?.id }
  });
}

function assertNoBareDocumentUrls(bot) {
  const violations = collectBareSupabaseUrlsInTextBlocks(bot);
  if (violations.length) {
    throw new Error(`URLs Supabase visíveis no texto do paciente: ${violations.join('; ')}`);
  }
}

function patch(bot) {
  patchVariables(bot);
  patchLgpdGroup(bot);
  patchLgpdAcceptGroup(bot);
  patchTelemedicineGroup(bot);
  patchTelemedicineAcceptGroup(bot);
  patchTelemedicineDeclineGroup(bot);
  patchTermsGroup(bot);
  patchTermsAcceptGroup(bot);
  patchDadosPessoais(bot);
  patchIneligibleTexts(bot);
  patchSinaisAlerta(bot);
  patchReceitaConfirmacao(bot);
  patchGatePagamento(bot);
  patchIneligibleGroup(bot);
  patchMedCountGroup(bot);
  patchMedicationGroups(bot);
  ensureRouteGroups(bot);
  patchFotoUpload(bot);
  patchConfirmacao(bot);
  patchFinalMessage(bot);
  patchWebhook(bot);
  rewireEdges(bot);
  assertNoBareDocumentUrls(bot);

  bot.name = 'Doctor Prescreve - Staging Safe';
  bot.publicId = 'doctor-prescreve-8rmljgu';
  bot.updatedAt = new Date().toISOString();
  return bot;
}

function main() {
  const bot = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  const patched = patch(bot);
  fs.writeFileSync(targetPath, JSON.stringify(patched));
  fs.writeFileSync(exportMirrorPath, JSON.stringify(patched));
  console.log('Typebot reorganized:', targetPath);
  console.log('Mirror:', exportMirrorPath);
  console.log('Groups:', patched.groups.length, 'Variables:', patched.variables.length, 'Edges:', patched.edges.length);
}

main();
