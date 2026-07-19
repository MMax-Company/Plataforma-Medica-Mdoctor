const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  patchReceitaAnterior,
  validatePatch,
  IDS,
  OPT_AVAILABLE,
  OPT_NOT_AVAILABLE,
  OPT_NONE
} = require('./patch-typebot-receita-anterior');
const { convertTypebotResponse } = require('../src/services/typebot-whatsapp.bridge');

const stagingPath = path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-staging-safe.json');

function loadBot() {
  return JSON.parse(fs.readFileSync(stagingPath, 'utf8'));
}

function findGroup(bot, id) {
  return bot.groups.find((group) => group.id === id);
}

function findEdge(bot, id) {
  return bot.edges.find((edge) => edge.id === id);
}

function testStructure() {
  const bot = loadBot();
  validatePatch(bot);

  const receita = findGroup(bot, IDS.grpReceita);
  const choice = receita.blocks.find((block) => block.id === IDS.blkReceitaChoice);
  assert.equal(choice.items.length, 3);
  assert.deepEqual(
    choice.items.map((item) => item.value),
    ['available_now', 'not_available_now', 'none']
  );

  assert.equal(findEdge(bot, IDS.edgeAvailable).to.groupId, IDS.grpData);
  assert.equal(findEdge(bot, IDS.edgeNotAvailable).to.groupId, IDS.grpPendingDoc);
  assert.equal(findEdge(bot, IDS.edgeNone).to.groupId, IDS.grpNone);
  assert.equal(findEdge(bot, IDS.edgeAgeWithin).to.groupId, IDS.grpContinueTerms);
  assert.equal(findEdge(bot, IDS.edgeAgeOver).to.groupId, IDS.grpOver180);
  assert.equal(findEdge(bot, IDS.edgeAgeUnknown).to.groupId, IDS.grpContinueUnknown);
  assert.equal(findEdge(bot, IDS.edgeContinueToTerms).to.groupId, IDS.grpTerms);
  assert.equal(findEdge(bot, IDS.edgeUnknownToTerms).to.groupId, IDS.grpTerms);
  assert.equal(findEdge(bot, 'edge_rec_sim'), undefined);

  const pending = findGroup(bot, IDS.grpPendingDoc);
  assert.match(JSON.stringify(pending), /pending_document/);
  assert.match(JSON.stringify(pending), /false/);
  assert.match(JSON.stringify(pending), /Nenhuma cobrança foi realizada/);

  const none = findGroup(bot, IDS.grpNone);
  assert.match(JSON.stringify(none), /ausência de receita anterior/);
  assert.match(JSON.stringify(none), /Nenhuma cobrança foi realizada/);

  const over180 = findGroup(bot, IDS.grpOver180);
  assert.match(JSON.stringify(over180), /mais de 180 dias/);
  assert.match(JSON.stringify(over180), /Nenhuma cobrança foi realizada/);

  const continueTerms = findGroup(bot, IDS.grpContinueTerms);
  assert.match(JSON.stringify(continueTerms), /eligible/);
  assert.doesNotMatch(JSON.stringify(continueTerms), /has_prescription_photo_ready|"sim"/);

  const unknown = findGroup(bot, IDS.grpContinueUnknown);
  assert.match(JSON.stringify(unknown), /prescription_date_requires_review/);
  assert.match(JSON.stringify(unknown), /true/);

  console.log('OK estrutura do bloco Receita anterior');
}

function testWhatsAppOptions() {
  const receitaResponse = convertTypebotResponse({
    messages: [{
      type: 'text',
      content: {
        richText: [{
          type: 'p',
          children: [{
            text:
              'Você possui uma receita médica anterior, emitida para você, e consegue enviar agora uma foto legível ou um arquivo em PDF?'
          }]
        }]
      }
    }],
    input: {
      type: 'choice input',
      items: [
        { content: OPT_AVAILABLE, value: 'available_now' },
        { content: OPT_NOT_AVAILABLE, value: 'not_available_now' },
        { content: OPT_NONE, value: 'none' }
      ]
    }
  });

  const listOutput = receitaResponse.find((output) => output.kind === 'list');
  assert.ok(listOutput, 'opções longas devem usar lista interativa no WhatsApp');
  assert.deepEqual(
    listOutput.choices.map((choice) => choice.description),
    [OPT_AVAILABLE, OPT_NOT_AVAILABLE, OPT_NONE]
  );

  const dataResponse = convertTypebotResponse({
    messages: [{ type: 'text', content: { plainText: 'A receita anterior foi emitida há quanto tempo?' } }],
    input: {
      type: 'choice input',
      items: [
        { content: 'Há até 180 dias', value: 'within_180_days' },
        { content: 'Há mais de 180 dias', value: 'over_180_days' },
        { content: 'Não sei informar', value: 'unknown' }
      ]
    }
  });
  const dataButtons = dataResponse.find((output) => output.kind === 'buttons');
  assert.ok(dataButtons, 'opções curtas da data da receita podem usar botões');
  assert.deepEqual(
    dataButtons.choices.map((choice) => choice.title),
    ['Há até 180 dias', 'Há mais de 180 dias', 'Não sei informar']
  );

  console.log('OK renderização WhatsApp das opções');
}

function testRoutesSummary() {
  const routes = [
    {
      option: OPT_AVAILABLE,
      value: 'available_now',
      next: 'Data da receita anterior',
      end: 'Segue para termos/pagamento após validação da idade'
    },
    {
      option: OPT_NOT_AVAILABLE,
      value: 'not_available_now',
      next: 'Receita indisponível agora',
      end: 'Encerra com eligibility_status=pending_document e sem cobrança'
    },
    {
      option: OPT_NONE,
      value: 'none',
      next: 'Sem receita anterior',
      end: 'Encerra com eligibility_status=ineligible e sem cobrança'
    }
  ];

  for (const route of routes) {
    console.log(`Rota ${route.value}: ${route.option} -> ${route.next} -> ${route.end}`);
  }
}

function main() {
  testStructure();
  testWhatsAppOptions();
  testRoutesSummary();
  console.log('Todos os testes do bloco Receita anterior passaram.');
}

if (require.main === module) {
  main();
}

module.exports = { testStructure, testWhatsAppOptions };
