const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const expectedRepo = 'MMax-Company/Plataforma-Medica-Mdoctor';
const legacyRepo = 'MMax-Company/Mdoctor-Prescreve';

function readGitConfig() {
  const configPath = path.join(root, '.git', 'config');
  if (!fs.existsSync(configPath)) return '';
  return fs.readFileSync(configPath, 'utf8');
}

function hasPath(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

const problems = [];
const warnings = [];
const gitConfig = readGitConfig();

if (!gitConfig.includes('github.com/MMax-Company/Plataforma-Medica-Mdoctor.git')) {
  problems.push(`remote origin deve apontar para ${expectedRepo}`);
}

if (gitConfig.includes('github.com/MMax-Company/Mdoctor-Prescreve.git')) {
  problems.push(`remote origin nao deve apontar para o legado ${legacyRepo}`);
}

const requiredPaths = [
  'mdoctor-backend/server.js',
  'mdoctor-backend/package.json',
  'mdoctor-panel/package.json',
  'mdoctor-panel/src/app/login/page.tsx',
  'mdoctor-automation/server.js',
  'mdoctor-automation/package.json',
  'docs/TRANSICAO-RAILWAY-GITHUB.md',
  'REPOSITORY-OFFICIAL.md'
];

for (const requiredPath of requiredPaths) {
  if (!hasPath(requiredPath)) problems.push(`estrutura oficial ausente: ${requiredPath}`);
}

const legacyOnlyPaths = [
  'src/server.js',
  'public/painel-medico.html',
  'public/painel-medico-premium.html'
];

for (const legacyPath of legacyOnlyPaths) {
  if (hasPath(legacyPath)) {
    warnings.push(`estrutura legado detectada na raiz: ${legacyPath}`);
  }
}

if (problems.length) {
  console.error('REPOSITORY IDENTITY CHECK FALHOU');
  for (const warning of warnings) console.error(`- aviso: ${warning}`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

for (const warning of warnings) console.warn(`aviso: ${warning}`);
console.log(`REPOSITORY IDENTITY OK: workspace alinhado com ${expectedRepo}.`);
