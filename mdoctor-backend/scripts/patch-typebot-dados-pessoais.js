/**
 * Bloco Dados Pessoais — ordem e perguntas separadas:
 * 1. Nome completo
 * 2. Data de nascimento
 * 3. CPF
 * 4. WhatsApp
 * 5. E-mail
 * 6. CEP
 * 7. Endereço completo
 *
 * Uso: node mdoctor-backend/scripts/patch-typebot-dados-pessoais.js
 */
const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-staging-safe.json');
const exportMirrorPath = path.join(
  __dirname,
  '../../docs/typebot/typebot-export-doctor-prescreve-8rmljgu (5).json'
);

const BLOCK_IDS = Object.freeze({
  nomeInput: 'ds9z9lnz3yayokyy8d81fudj',
  birthInput: 'ar8jtu7sa8gfndqeebrvyj15',
  cpfInput: 'dein7u2qnr8q32p2lv1krd5p',
  phoneInput: 'tbla9w2i2kbeyzun88hai3s9',
  emailInput: 'dwoaqosurlamebpra9yf7pm4',
  cepInput: 'blk_0oydu2f7',
  addressInput: 'q78qjnk6ticwkeifl7xe2rju'
});

const PROMPTS = Object.freeze([
  { id: 'prompt_nome', text: 'Qual é o seu nome completo?' },
  { id: 'prompt_data_nascimento', text: 'Qual é a sua data de nascimento? Informe no formato DD/MM/AAAA.' },
  { id: 'prompt_cpf', text: 'Qual é o seu CPF?' },
  { id: 'prompt_whatsapp', text: 'Qual é o seu WhatsApp?' },
  { id: 'prompt_email', text: 'Qual é o seu e-mail?' },
  { id: 'prompt_cep', text: 'Qual é o seu CEP?' },
  { id: 'prompt_endereco', text: 'Qual é o seu endereço completo?' }
]);

function findGroup(bot, titlePart) {
  return bot.groups.find((g) => String(g.title || '').toLowerCase().includes(titlePart.toLowerCase()));
}

function promptBlock(id, text) {
  return {
    id,
    type: 'text',
    content: {
      richText: [{ id: `${id}_p`, type: 'p', children: [{ text }] }]
    }
  };
}

function findBlockById(group, blockId) {
  const block = group.blocks.find((b) => b.id === blockId);
  if (!block) throw new Error(`Bloco não encontrado: ${blockId}`);
  return JSON.parse(JSON.stringify(block));
}

function patchDadosPessoais(bot) {
  const dados = findGroup(bot, 'Dados Pessoais');
  if (!dados) throw new Error('Grupo Dados Pessoais não encontrado');

  const nomeInput = findBlockById(dados, BLOCK_IDS.nomeInput);
  const birthInput = findBlockById(dados, BLOCK_IDS.birthInput);
  const cpfInput = findBlockById(dados, BLOCK_IDS.cpfInput);
  const phoneInput = findBlockById(dados, BLOCK_IDS.phoneInput);
  const emailInput = findBlockById(dados, BLOCK_IDS.emailInput);
  const cepInput = findBlockById(dados, BLOCK_IDS.cepInput);
  const addressInput = findBlockById(dados, BLOCK_IDS.addressInput);

  delete nomeInput.outgoingEdgeId;
  delete birthInput.outgoingEdgeId;
  delete cpfInput.outgoingEdgeId;
  delete phoneInput.outgoingEdgeId;
  delete emailInput.outgoingEdgeId;
  delete cepInput.outgoingEdgeId;
  delete addressInput.outgoingEdgeId;

  if (birthInput.options) {
    birthInput.options.labels = birthInput.options.labels || {};
    birthInput.options.labels.placeholder = 'Nascimento (dd/mm/aaaa ou 8 dígitos)';
    birthInput.options.retryMessageContent =
      'Data inválida. Use dd/mm/aaaa, ddmmaaaa ou dd-mm-aaaa (ex.: 31/12/1980).';
  }
  if (addressInput.options?.labels) {
    addressInput.options.labels.placeholder = 'Rua, número, complemento, bairro e cidade';
  }

  const existingEdgeId = dados.blocks.find((b) => b.outgoingEdgeId)?.outgoingEdgeId;
  const outgoingEdgeId =
    (existingEdgeId && (bot.edges || []).some((e) => e.id === existingEdgeId))
      ? existingEdgeId
      : 'edge_dados_to_receita';
  addressInput.outgoingEdgeId = outgoingEdgeId;

  dados.blocks = [
    promptBlock(PROMPTS[0].id, PROMPTS[0].text),
    nomeInput,
    promptBlock(PROMPTS[1].id, PROMPTS[1].text),
    birthInput,
    promptBlock(PROMPTS[2].id, PROMPTS[2].text),
    cpfInput,
    promptBlock(PROMPTS[3].id, PROMPTS[3].text),
    phoneInput,
    promptBlock(PROMPTS[4].id, PROMPTS[4].text),
    emailInput,
    promptBlock(PROMPTS[5].id, PROMPTS[5].text),
    cepInput,
    promptBlock(PROMPTS[6].id, PROMPTS[6].text),
    addressInput
  ];

  const edge = (bot.edges || []).find((e) => e.id === outgoingEdgeId);
  if (edge?.from) edge.from.blockId = BLOCK_IDS.addressInput.slice(0, 13);
}

function assertDadosPessoais(bot) {
  const dados = findGroup(bot, 'Dados Pessoais');
  const inputIds = dados.blocks.filter((b) => b.type !== 'text').map((b) => b.id);
  const expected = [
    BLOCK_IDS.nomeInput,
    BLOCK_IDS.birthInput,
    BLOCK_IDS.cpfInput,
    BLOCK_IDS.phoneInput,
    BLOCK_IDS.emailInput,
    BLOCK_IDS.cepInput,
    BLOCK_IDS.addressInput
  ];
  if (inputIds.join(',') !== expected.join(',')) {
    throw new Error(`Ordem de inputs inválida: ${inputIds.join(' -> ')}`);
  }
  const addressBlock = dados.blocks.find((b) => b.id === BLOCK_IDS.addressInput);
  if (!addressBlock?.outgoingEdgeId) throw new Error('Endereço deve ter outgoingEdgeId');
  for (const prompt of PROMPTS) {
    if (!dados.blocks.some((b) => b.id === prompt.id)) {
      throw new Error(`Prompt ausente: ${prompt.id}`);
    }
  }
}

function writeBot(filePath, bot) {
  fs.writeFileSync(filePath, `${JSON.stringify(bot, null, 2)}\n`);
}

const bot = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
patchDadosPessoais(bot);
assertDadosPessoais(bot);
writeBot(targetPath, bot);
if (fs.existsSync(exportMirrorPath)) writeBot(exportMirrorPath, bot);

console.log('Dados Pessoais atualizado:', targetPath);
console.log('Ordem:', Object.values(BLOCK_IDS).join(' -> '));

module.exports = { patchDadosPessoais, assertDadosPessoais, BLOCK_IDS, PROMPTS };
