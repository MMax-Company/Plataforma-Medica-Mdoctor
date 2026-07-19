/**
 * Aplica todos os patches de blocos Typebot no staging-safe (PRs #8–#22).
 *
 * Pré-requisitos já aplicados na PR #26:
 *   patch-typebot-resumo-dados.js, patch-typebot-bloco05-nome-social.js,
 *   integrate-staging-receita-whatsapp-pedidos.js
 *
 * Uso: node mdoctor-backend/scripts/integrate-staging-typebot-all-blocks.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const STAGING = path.join(ROOT, 'docs/typebot/typebot-doctor-prescreve-staging-safe.json');
const EXPORT = path.join(ROOT, 'docs/typebot/typebot-export-doctor-prescreve-8rmljgu (5).json');

const STEPS = [
  ['PR #15 solicitacao elegivel', 'node mdoctor-backend/scripts/patch-typebot-solicitacao-inicialmente-elegivel.js --local'],
  ['PR #14 declaracao elegibilidade', 'node mdoctor-backend/scripts/patch-typebot-declaracao-elegibilidade.js --local'],
  ['PR #11 sinais alerta', 'node mdoctor-backend/scripts/patch-typebot-sinais-alerta.js --file docs/typebot/typebot-doctor-prescreve-staging-safe.json'],
  ['PR #12 telemedicina', 'node mdoctor-backend/scripts/patch-typebot-telemedicina.js --local'],
  ['PR #9 condicoes saude', 'node mdoctor-backend/scripts/patch-typebot-condicoes-saude.js'],
  ['PR #8 tempo uso', 'node mdoctor-backend/scripts/patch-typebot-tempo-uso.js'],
  ['PR #17 receita anterior', 'node mdoctor-backend/scripts/patch-typebot-receita-anterior.js'],
  ['PR #16 dados pessoais', 'node mdoctor-backend/scripts/patch-typebot-dados-pessoais.js'],
  ['PR #19 termos uso', 'node mdoctor-backend/scripts/patch-typebot-termos-uso.js --local'],
  ['PR #21 quantidade medicamentos', 'node mdoctor-backend/scripts/patch-typebot-quantidade-medicamentos.js'],
  ['PR #22 medicamentos 1-3', 'node mdoctor-backend/scripts/patch-typebot-medicamentos.js'],
  ['espelho export', `cp "${STAGING}" "${EXPORT}"`],
  ['validacao', 'node mdoctor-backend/scripts/validate-typebot-staging-safe.js']
];

function run(label, cmd) {
  console.log(`\n>> ${label}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

function main() {
  if (!fs.existsSync(STAGING)) throw new Error('staging-safe ausente: ' + STAGING);
  for (const [label, cmd] of STEPS) run(label, cmd);
  console.log('\nIntegração concluída:', STAGING);
}

main();
