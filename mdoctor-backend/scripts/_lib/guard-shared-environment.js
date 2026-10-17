// Helper centralizado de segurança para scripts de scripts/ que podem
// escrever em banco real (Supabase), Stripe ou Meta.
//
// Achado 10-11/10/2026 (ver docs/PROJECT_MEMORY.md): não existe staging
// Supabase isolado de produção neste projeto — usihurogvphtjedyhyfl é o
// único projeto configurado em mdoctor-backend/.env e é compartilhado entre
// staging e produção. Dois incidentes reais já aconteceram por falta desta
// checagem: (1) test-support-post-finalization-routing-live.js escreveu
// appointments/support_tickets/audit_logs reais (71c734c5-791e-48e0-937c-
// 6aa24e122edb, d6f84caa-6d0c-48e9-91de-afdf98f59e96); (2) validar que a
// PRIMEIRA versão deste helper "libera com ALLOW=true" rodando de verdade
// contra o banco (em vez de só offline, com mock) criou um segundo
// appointment/patient/triage_session reais (3a86b4a9-601e-4598-a7a1-
// 2b467e577803, patient 55d5784e-9cc6-4ca7-88a4-0e9f66291ab8). Daí a
// dupla confirmação abaixo (flag + project ref esperado) — e por que a
// VALIDAÇÃO deste helper (scripts/test-guard-shared-environment-unit.js)
// é inteiramente offline, nunca contra infraestrutura real.
//
// Uso: chamar guardSharedEnvironment() depois do dotenv carregar
// SUPABASE_URL (require('./load-dotenv') ou require('dotenv').config()) e
// ANTES de qualquer ação real — initSupabase(), chamada HTTP contra um
// backend real, ou qualquer SDK do Stripe/Meta. Scripts só-leitura não
// precisam chamar isto.
const SHARED_PROD_STAGING_PROJECT_REF = 'usihurogvphtjedyhyfl';

function isTargetingSharedProjectByUrl(url) {
  return String(url || '').includes(SHARED_PROD_STAGING_PROJECT_REF);
}

// Alguns scripts não chamam o Supabase direto — fazem HTTP contra um backend
// (ex.: BACKEND_URL de staging) que, por sua vez, grava no mesmo projeto
// compartilhado. Para esses, o guard também considera BACKEND_URL/PANEL_URL
// quando apontam para o domínio de staging/produção real (não localhost).
const LIVE_BACKEND_HOST_PATTERNS = [
  /\.up\.railway\.app$/i,
  /mdoctor-backend/i
];

function isTargetingLiveBackendByUrl(url) {
  if (!url) return false;
  try {
    const host = new URL(url).host;
    return LIVE_BACKEND_HOST_PATTERNS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

/**
 * Bloqueia a execução (process.exit(1), sem lançar — para nunca ser
 * engolido por um try/catch do script chamador) a menos que DUAS
 * confirmações explícitas estejam presentes e corretas: a flag booleana E
 * o project ref esperado digitado por extenso. Exigir as duas evita que um
 * ALLOW=true copiado de outro script (ou deixado em uma sessão de shell)
 * libere a execução por acidente — quem roda tem de digitar
 * deliberadamente o project ref que está confirmando.
 *
 * @param {object} opts
 * @param {string} [opts.envVarName] nome da variável de confirmação booleana.
 * @param {string} [opts.expectedProjectRefEnvVarName] nome da variável que
 *        deve conter, por extenso, o project ref compartilhado
 *        (usihurogvphtjedyhyfl) para a confirmação ser aceita.
 * @param {string[]} [opts.urlsToCheck] URLs JÁ RESOLVIDAS (valores, não
 *        nomes de variável — ex.: [process.env.BACKEND_URL]) a considerar,
 *        além de SUPABASE_URL.
 * @param {string} [opts.context] rótulo curto do script, só para a mensagem.
 */
function guardSharedEnvironment({
  envVarName = 'ALLOW_SHARED_PROD_STAGING_DB',
  expectedProjectRefEnvVarName = 'CONFIRM_SUPABASE_PROJECT_REF',
  urlsToCheck = [],
  context = 'este script'
} = {}) {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const targetsSharedBySupabase = isTargetingSharedProjectByUrl(supabaseUrl);
  const targetsLiveBackend = urlsToCheck.some((url) => isTargetingLiveBackendByUrl(url));

  if (!targetsSharedBySupabase && !targetsLiveBackend) return; // ambiente isolado/local — nada a bloquear

  const allowFlag = process.env[envVarName] === 'true';
  const confirmedRef = process.env[expectedProjectRefEnvVarName] || '';
  const refConfirmed = confirmedRef === SHARED_PROD_STAGING_PROJECT_REF;

  if (allowFlag && refConfirmed) return; // as DUAS confirmações presentes e corretas

  const reason = targetsSharedBySupabase
    ? `SUPABASE_URL aponta para o projeto ${SHARED_PROD_STAGING_PROJECT_REF} (compartilhado staging/produção)`
    : 'uma das URLs configuradas aponta para um backend real (staging/produção)';

  const missing = [];
  if (!allowFlag) missing.push(`${envVarName}=true`);
  if (!refConfirmed) missing.push(`${expectedProjectRefEnvVarName}=${SHARED_PROD_STAGING_PROJECT_REF}`);

  console.error(
    `BLOQUEADO: ${context} tentou rodar contra o ambiente real — ${reason}. ` +
    'Este script pode escrever dados reais. Para confirmar que você sabe disso e quer mesmo ' +
    `rodar aqui, defina AS DUAS variáveis a seguir explicitamente nesta execução: ${missing.join(' e ')}. ` +
    'Prefira apontar para um ambiente isolado antes de rodar este script.'
  );
  process.exit(1);
}

module.exports = {
  SHARED_PROD_STAGING_PROJECT_REF,
  isTargetingSharedProjectByUrl,
  isTargetingLiveBackendByUrl,
  guardSharedEnvironment
};
