const { execFileSync } = require('child_process');

const base = process.argv[2];
if (!base || !/^[0-9a-f]{40}$/i.test(base) || /^0+$/.test(base)) {
  console.error('Base Git SHA inválido ou ausente.');
  process.exit(1);
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

const addedFiles = git(['diff', '--name-only', '--diff-filter=A', `${base}...HEAD`])
  .split(/\r?\n/)
  .filter(Boolean);

const realEnvFiles = addedFiles.filter((file) => {
  const name = file.split('/').pop();
  return name.startsWith('.env') && !/^\.env(?:\.[a-z0-9_-]+)?\.example$/i.test(name);
});

const patterns = [
  ['Stripe secret key', /sk_(?:live|test)_[A-Za-z0-9]+/],
  ['Stripe webhook secret', /whsec_[A-Za-z0-9]+/],
  ['JWT token', /eyJhbGciOiJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/],
  ['Supabase service key assignment', /SUPABASE_(?:SERVICE_ROLE_KEY|SERVICE_KEY)[ \t]*=[ \t]*[^\s#]+/],
  ['Memed secret assignment', /MEMED_(?:API_KEY|SECRET_KEY)[ \t]*=[ \t]*[^\s#]+/],
  ['JWT secret assignment', /JWT_SECRET[ \t]*=[ \t]*[^\s#]+/],
  ['Default medical password', /MEDICO_PASS[ \t]*=[ \t]*admin123/],
];

const diff = git(['diff', '--unified=0', '--no-color', `${base}...HEAD`]);
const addedLines = diff
  .split(/\r?\n/)
  .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
  .map((line) => line.slice(1));

const findings = [];
for (const line of addedLines) {
  for (const [name, pattern] of patterns) {
    if (pattern.test(line)) findings.push(name);
  }
}

if (realEnvFiles.length || findings.length) {
  console.error('CI SECRET CHECK FALHOU');
  for (const file of realEnvFiles) console.error(`- arquivo de ambiente real adicionado: ${file}`);
  for (const finding of [...new Set(findings)]) console.error(`- possível segredo novo: ${finding}`);
  process.exit(1);
}

console.log('CI SECRET CHECK OK: nenhum arquivo .env real ou segredo óbvio foi adicionado.');
