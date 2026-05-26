const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ignoredDirs = new Set(['node_modules', '.next', '.git', '.railway', 'dist', 'build', 'coverage', 'whatsapp_auth']);
const allowedEnvExamples = new Set(['.env.example', '.env.production.example']);

const secretPatterns = [
  { name: 'Stripe secret key', pattern: /sk_(live|test)_[A-Za-z0-9]+/ },
  { name: 'Stripe webhook secret', pattern: /whsec_[A-Za-z0-9]+/ },
  { name: 'JWT token', pattern: /eyJhbGciOiJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
  { name: 'Supabase service key assignment', pattern: /SUPABASE_(SERVICE_ROLE_KEY|SERVICE_KEY)[ \t]*=[ \t]*[^\s#]+/ },
  { name: 'Memed secret assignment', pattern: /MEMED_(API_KEY|SECRET_KEY)[ \t]*=[ \t]*[^\s#]+/ },
  { name: 'JWT secret assignment', pattern: /JWT_SECRET[ \t]*=[ \t]*[^\s#]+/ },
  { name: 'Default medical password', pattern: /MEDICO_PASS[ \t]*=[ \t]*admin123/ }
];

const problems = [];
const warnings = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relative = path.relative(root, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (entry.name.startsWith('.env') && !allowedEnvExamples.has(entry.name)) {
      warnings.push(`${relative}: arquivo .env real existe localmente; não transfira para o GitHub`);
      continue;
    }

    if (/\.log$/i.test(entry.name) || /\.err\.log$/i.test(entry.name)) {
      warnings.push(`${relative}: log local existe; não transfira para o GitHub`);
      continue;
    }

    if (/\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|gz|woff2?)$/i.test(entry.name)) continue;

    const content = fs.readFileSync(fullPath, 'utf8');
    for (const rule of secretPatterns) {
      if (rule.pattern.test(content)) problems.push(`${relative}: possível segredo detectado (${rule.name})`);
    }
  }
}

walk(root);

if (problems.length) {
  console.error('PRE-GITHUB CHECK FALHOU');
  for (const warning of warnings) console.error(`- aviso: ${warning}`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

for (const warning of warnings) console.warn(`aviso: ${warning}`);
console.log('PRE-GITHUB CHECK OK: nenhum .env real ou segredo óbvio encontrado nos arquivos versionáveis.');
