const { execFileSync } = require('child_process');

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

const SECRET_PATTERNS = [
  ['Stripe secret key', /sk_(?:live|test)_[A-Za-z0-9]+/],
  ['Stripe webhook secret', /whsec_[A-Za-z0-9]+/],
  ['JWT token', /eyJhbGciOiJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/],
  ['Supabase service key assignment', /SUPABASE_(?:SERVICE_ROLE_KEY|SERVICE_KEY)[ \t]*=[ \t]*[^\s#]+/],
  ['Memed secret assignment', /MEMED_(?:API_KEY|SECRET_KEY)[ \t]*=[ \t]*[^\s#]+/],
  ['JWT secret assignment', /JWT_SECRET[ \t]*=[ \t]*[^\s#]+/],
  ['Default medical password', /MEDICO_PASS[ \t]*=[ \t]*admin123/],
];

// Isenção ESTRITA, só para o achado "JWT secret assignment": um script de
// teste pode precisar de um JWT_SECRET fixo só para assinar tokens locais
// descartáveis (sem rede/banco real) — ex.:
// mdoctor-backend/scripts/test-support-chat-authorization.js. Isso nunca é um
// segredo real, mas bate no padrão textual. A isenção exige as DUAS coisas
// ao mesmo tempo: (1) o arquivo onde a linha foi adicionada é reconhecido
// como arquivo de teste (TEST_FILE_PATTERN) e (2) o valor entre aspas na
// própria linha começa literalmente com `test_` (SYNTHETIC_TEST_SECRET_LITERAL).
// Não existe isenção para nenhum outro padrão, nem para JWT_SECRET fora de
// arquivo de teste, nem para qualquer valor que não comece com `test_`.
const TEST_FILE_PATTERN = /(^|\/)(test[-_][^/]*\.(?:js|ts|mjs|cjs)|[^/]*\.test\.(?:js|ts|mjs|cjs)|__tests__\/.*)$/i;
const SYNTHETIC_TEST_SECRET_LITERAL = /['"`]test_[A-Za-z0-9_]*['"`]/;

function isTestFilePath(filePath) {
  return TEST_FILE_PATTERN.test(filePath);
}

function isAllowlistedJwtTestAssignment(filePath, line) {
  return isTestFilePath(filePath) && SYNTHETIC_TEST_SECRET_LITERAL.test(line);
}

function isRealEnvFile(filePath) {
  const name = filePath.split('/').pop();
  return name.startsWith('.env') && !/^\.env(?:\.[a-z0-9_-]+)?\.example$/i.test(name);
}

// Acha os nomes de achado para uma única linha ADICIONADA (sem o '+' do
// diff), já aplicando a isenção estrita acima. filePath é obrigatório
// porque a isenção só vale dentro de um arquivo de teste.
function scanAddedLine(filePath, line) {
  const findings = [];
  for (const [name, pattern] of SECRET_PATTERNS) {
    if (!pattern.test(line)) continue;
    if (name === 'JWT secret assignment' && isAllowlistedJwtTestAssignment(filePath, line)) continue;
    findings.push(name);
  }
  return findings;
}

// Faz o parsing de `git diff --unified=0` preservando a associação entre
// cada linha adicionada e o arquivo em que ela foi adicionada — necessário
// para a isenção acima, que é restrita por arquivo.
function collectAddedLinesByFile(diffText) {
  const result = [];
  let currentFile = null;
  for (const rawLine of diffText.split(/\r?\n/)) {
    const fileHeaderMatch = /^\+\+\+ b\/(.+)$/.exec(rawLine);
    if (fileHeaderMatch) {
      currentFile = fileHeaderMatch[1];
      continue;
    }
    if (rawLine.startsWith('+++') || rawLine.startsWith('---')) continue;
    if (rawLine.startsWith('+') && currentFile) {
      result.push({ filePath: currentFile, line: rawLine.slice(1) });
    }
  }
  return result;
}

function runCheck(base) {
  const addedFiles = git(['diff', '--name-only', '--diff-filter=A', `${base}...HEAD`])
    .split(/\r?\n/)
    .filter(Boolean);

  const realEnvFiles = addedFiles.filter(isRealEnvFile);

  const diff = git(['diff', '--unified=0', '--no-color', `${base}...HEAD`]);
  const addedLines = collectAddedLinesByFile(diff);

  const findings = [];
  for (const { filePath, line } of addedLines) {
    findings.push(...scanAddedLine(filePath, line));
  }

  return { realEnvFiles, findings: [...new Set(findings)] };
}

module.exports = {
  SECRET_PATTERNS,
  TEST_FILE_PATTERN,
  SYNTHETIC_TEST_SECRET_LITERAL,
  isTestFilePath,
  isAllowlistedJwtTestAssignment,
  isRealEnvFile,
  scanAddedLine,
  collectAddedLinesByFile,
  runCheck,
};

if (require.main === module) {
  const base = process.argv[2];
  if (!base || !/^[0-9a-f]{40}$/i.test(base) || /^0+$/.test(base)) {
    console.error('Base Git SHA inválido ou ausente.');
    process.exit(1);
  }

  const { realEnvFiles, findings } = runCheck(base);

  if (realEnvFiles.length || findings.length) {
    console.error('CI SECRET CHECK FALHOU');
    for (const file of realEnvFiles) console.error(`- arquivo de ambiente real adicionado: ${file}`);
    for (const finding of findings) console.error(`- possível segredo novo: ${finding}`);
    process.exit(1);
  }

  console.log('CI SECRET CHECK OK: nenhum arquivo .env real ou segredo óbvio foi adicionado.');
}
