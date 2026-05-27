const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const isRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
const localEnvPath = path.join(root, '.env.local');
const envFileNames = !isRailway && fs.existsSync(localEnvPath)
  ? ['.env.local', '.env.staging']
  : ['.env', '.env.local', '.env.staging'];
const envFiles = envFileNames
  .map((name) => ({ name, path: path.join(root, name) }))
  .filter((item) => fs.existsSync(item.path));

function parseEnv(content) {
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return values;
}

function isTruthy(value) {
  return String(value || '').toLowerCase() === 'true';
}

function isLocalFile(name, env) {
  return name === '.env.local' || (name === '.env' && (env.ENVIRONMENT_NAME || env.NODE_ENV || 'development') !== 'staging');
}

function isNonProduction(env) {
  return (env.NODE_ENV || process.env.NODE_ENV || 'development') !== 'production';
}

function containsRailwayUrl(value) {
  return /\.up\.railway\.app\b|\.railway\.internal\b/i.test(String(value || ''));
}

function checkEnvFile(file) {
  const envContent = fs.readFileSync(file.path, 'utf8');
  const env = parseEnv(envContent);
  const problems = [];
  const local = isLocalFile(file.name, env);
  const nonProduction = isNonProduction(env);

  if (env.NODE_ENV === 'production' && !isRailway) {
    problems.push(`${file.name} esta com NODE_ENV=production fora da Railway`);
  }

  for (const [name, value] of Object.entries(env)) {
    const stringValue = String(value);

    if (nonProduction && stringValue.includes('sk_live')) {
      problems.push(`${file.name}:${name} contem chave Stripe live em ambiente nao-producao`);
    }

    if (local && containsRailwayUrl(stringValue)) {
      problems.push(`${file.name}:${name} aponta para Railway; local deve usar localhost ou mock`);
    }

    if (stringValue.includes('.railway.internal') && !isRailway) {
      problems.push(`${file.name}:${name} usa host *.railway.internal fora da Railway`);
    }
  }

  if (nonProduction && (env.MEMED_ENVIRONMENT === 'production' || env.MEMED_ENV === 'production')) {
    problems.push(`${file.name} configura Memed production fora de NODE_ENV=production`);
  }

  if (local && env.WHATSAPP_ENABLED !== undefined && env.WHATSAPP_ENABLED !== 'false') {
    problems.push(`${file.name} deve manter WHATSAPP_ENABLED=false em ambiente local`);
  }

  if (local && env.DELIVERY_MOCK_ENABLED !== undefined && env.DELIVERY_MOCK_ENABLED !== 'true') {
    problems.push(`${file.name} deve manter DELIVERY_MOCK_ENABLED=true em ambiente local`);
  }

  if (local && isTruthy(env.LEGACY_COMPAT_STRIPE)) {
    problems.push(`${file.name} nao deve ativar LEGACY_COMPAT_STRIPE em ambiente local`);
  }

  if (local && isTruthy(env.LEGACY_COMPAT_TYPEBOT)) {
    problems.push(`${file.name} nao deve ativar LEGACY_COMPAT_TYPEBOT em ambiente local`);
  }

  return problems;
}

if (!envFiles.length || isRailway) {
  process.exit(0);
}

const problems = envFiles.flatMap(checkEnvFile);

if (problems.length) {
  console.error('ENV CHECK BLOQUEADO: ambiente local/staging contem configuracao perigosa.');
  for (const problem of problems) console.error(`- ${problem}`);
  console.error('Use .env.local/.env.staging seguros ou rode producao somente dentro da Railway.');
  process.exit(1);
}

console.log(`ENV CHECK OK: ${envFiles.map((item) => item.name).join(', ')} sem sinais obvios de producao acidental.`);
