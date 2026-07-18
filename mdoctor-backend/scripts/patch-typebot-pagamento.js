/**
 * Patch do bloco Pagamento no export Typebot staging-safe.
 * Uso: node scripts/patch-typebot-pagamento.js [arquivo.json]
 */
const fs = require('fs');
const path = require('path');

const defaultFile = path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-staging-safe.json');
const targetFile = path.resolve(process.argv[2] || defaultFile);
const bot = JSON.parse(fs.readFileSync(targetFile, 'utf8'));

const PAYMENT_GROUP_ID = 'ulwovuu3brh5oeawwcuvr0h2';
const PAYMENT_INPUT_ID = 'rapfykn1f1uno89ypqmwi43f';

function richParagraph(text) {
  return {
    id: `p_${Math.random().toString(36).slice(2, 10)}`,
    type: 'p',
    children: [{ text }]
  };
}

const group = bot.groups.find((item) => item.id === PAYMENT_GROUP_ID || item.title === 'Pagamento');
if (!group) {
  console.error('Grupo Pagamento não encontrado');
  process.exit(1);
}

group.blocks = [
  {
    id: 'blk_pay_intro',
    type: 'text',
    content: {
      richText: [
        richParagraph('O valor da consulta médica e da análise das informações enviadas é de R$ 69,90.'),
        richParagraph('O pagamento corresponde à consulta e não garante a emissão da receita.'),
        richParagraph('Após a confirmação do pagamento, o atendimento continuará automaticamente.')
      ]
    }
  },
  {
    id: PAYMENT_INPUT_ID,
    outgoingEdgeId: 'xxpw9p5hptmv7u7qlatptirp',
    type: 'payment input',
    options: {
      labels: {
        button: 'Pagar R$ 69,90',
        success: 'Pagamento confirmado.\n\nAgora vamos coletar as informações dos medicamentos e concluir o envio da sua receita anterior.'
      },
      additionalInformation: {
        description: 'Renovação de receita - Doctor Prescreve',
        name: '{{Nome_Completo}}',
        email: '{{Email}}',
        phoneNumber: '{{whatsapp}}'
      },
      credentialsId: 'cmmntjz0w000304jpawo0m0ss',
      currency: 'BRL',
      amount: '69.90'
    }
  }
];

fs.writeFileSync(targetFile, `${JSON.stringify(bot, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, file: targetFile, group: group.title, blocks: group.blocks.length }));
