#!/usr/bin/env node
/**
 * Remove file input; reordena fluxo: medicamentos → confirmação → webhook → link upload_url.
 * Mapeia upload_url da resposta HTTP (n8n/backend) via responseVariableMapping.
 */
const fs = require('fs');
const path = require('path');

const files = [
  path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-staging-safe.json'),
  path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-production.json')
];

const STAGING_WH = 'https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook';
const PROD_WH = 'https://n8n-node-production-f844.up.railway.app/webhook/typebot-webhook';

const IDS = {
  fotoGroup: 'grp_foto_receita',
  confirmGroup: 'wupo36l29a2x66rh0bwf5yex',
  endGroup: 'bhrt6it0ud0teq3tw26q40ba',
  webhookGroup: 'g60uvyvi39v47j4ahnoxkxzn',
  webhookBlock: 'axuwb907imxr22bqbnugj3ab',
  edgeWebhookOut: 'vgmrhkywl7kagoaeaq2ybdmg',
  medEdgesToConfirm: ['edge_route_med1_is_1', 'edge_route_med2_is_2', 'edge_med3_to_foto']
};

function ensureVariable(bot, name, sample = '') {
  bot.variables = bot.variables || [];
  let v = bot.variables.find((x) => x.name === name);
  if (!v) {
    v = { id: `var_${name}`, name, sampleValue: sample };
    bot.variables.push(v);
  }
  return v;
}

function stripPrescriptionFileFromWebhookBody(body) {
  if (!body || typeof body !== 'string') return body;
  return body
    .replace(/^\s*"previous_prescription_file":\s*"[^"]*",?\n/m, '')
    .replace(/,\n\s*"previous_prescription_file":\s*"[^"]*"/m, '')
    .replace(/^\s*"foto_receita_url":\s*"[^"]*",?\n/m, '')
    .replace(/,\n\s*"foto_receita_url":\s*"[^"]*"/m, '');
}

function patchBot(bot, webhookUrl) {
  const uploadVar = ensureVariable(
    bot,
    'upload_url',
    'https://painel-medico-staging-staging.up.railway.app/upload-receita/token-exemplo'
  );

  const fotoGroup = bot.groups.find((g) => g.id === IDS.fotoGroup);
  if (!fotoGroup) throw new Error('grp_foto_receita not found');

  fotoGroup.title = 'ENVIO DA RECEITA ANTERIOR';
  fotoGroup.blocks = [
    {
      id: 'blk_foto_txt',
      type: 'text',
      content: {
        richText: [
          {
            id: 'p_upload_intro',
            type: 'p',
            children: [
              {
                text: 'Para concluir sua solicitação, envie agora a foto da sua receita anterior. Seu atendimento só será encaminhado para análise médica após o envio da imagem.'
              }
            ]
          }
        ]
      }
    },
    {
      id: 'blk_foto_link',
      type: 'text',
      outgoingEdgeId: 'edge_foto_link_to_end',
      content: {
        richText: [
          {
            id: 'p_upload_btn',
            type: 'p',
            children: [
              {
                type: 'a',
                url: '{{upload_url}}',
                children: [{ text: 'Enviar foto da receita' }]
              }
            ]
          },
          {
            id: 'p_upload_hint',
            type: 'p',
            children: [{ text: 'Formatos: JPG, PNG ou PDF (até 10 MB).' }]
          }
        ]
      }
    }
  ];

  const webhookGroup = bot.groups.find((g) => g.id === IDS.webhookGroup);
  if (!webhookGroup) throw new Error('Webhook group not found');

  const webhookBlock = webhookGroup.blocks.find((b) => b.id === IDS.webhookBlock || b.type === 'Webhook');
  if (!webhookBlock) throw new Error('Webhook block not found');

  webhookBlock.options = webhookBlock.options || {};
  webhookBlock.options.isCustomBody = true;
  webhookBlock.options.webhook = webhookBlock.options.webhook || {};
  webhookBlock.options.webhook.url = webhookUrl;
  if (typeof webhookBlock.options.webhook.body === 'string') {
    webhookBlock.options.webhook.body = stripPrescriptionFileFromWebhookBody(webhookBlock.options.webhook.body);
  }
  webhookBlock.options.responseVariableMapping = [
    {
      id: 'map_upload_url',
      variableId: uploadVar.id,
      bodyPath: 'upload_url'
    }
  ];
  webhookBlock.outgoingEdgeId = IDS.edgeWebhookOut;

  webhookGroup.blocks = webhookGroup.blocks.filter((b) => b.id !== 'blk_set_upload_url');

  bot.edges = bot.edges || [];

  bot.edges = bot.edges.filter((e) => e.id !== 'edge_foto_to_confirm' && e.id !== 'edge_foto_file_out');

  for (const edgeId of IDS.medEdgesToConfirm) {
    const edge = bot.edges.find((e) => e.id === edgeId);
    if (edge) edge.to = { groupId: IDS.confirmGroup };
  }

  const webhookOut = bot.edges.find((e) => e.id === IDS.edgeWebhookOut);
  if (webhookOut) {
    webhookOut.from = { blockId: webhookBlock.id };
    webhookOut.to = { groupId: IDS.fotoGroup };
  } else {
    bot.edges.push({
      id: IDS.edgeWebhookOut,
      from: { blockId: webhookBlock.id },
      to: { groupId: IDS.fotoGroup }
    });
  }

  if (!bot.edges.some((e) => e.id === 'edge_foto_link_to_end')) {
    bot.edges.push({
      id: 'edge_foto_link_to_end',
      from: { blockId: 'blk_foto_link' },
      to: { groupId: IDS.endGroup }
    });
  }

  const hasFileInput = JSON.stringify(bot).includes('"type":"file input"') || JSON.stringify(bot).includes('"type": "file input"');
  return { webhookUrl, hasFileInput, uploadVarId: uploadVar.id };
}

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.warn('skip missing', file);
    continue;
  }
  const bot = JSON.parse(fs.readFileSync(file, 'utf8'));
  const webhookUrl = file.includes('production') ? PROD_WH : STAGING_WH;
  const result = patchBot(bot, webhookUrl);
  fs.writeFileSync(file, JSON.stringify(bot, null, 2));
  console.log(JSON.stringify({ file: path.basename(file), ...result }, null, 2));
}
