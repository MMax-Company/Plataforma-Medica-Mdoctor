// Teste unitário do helper centralizado scripts/_lib/guard-shared-environment.js.
//
// REGRA PERMANENTE (incidente 11/10/2026): a validação deste helper é
// SEMPRE 100% offline — nunca contra Supabase, Stripe, Meta ou qualquer
// backend real. A primeira tentativa de "provar que ALLOW=true libera"
// rodando de verdade um script real contra o banco compartilhado
// (usihurogvphtjedyhyfl) criou um appointment/patient/triage_session
// sintéticos reais lá. Este arquivo nunca chama initSupabase, nunca faz
// fetch/HTTP, nunca importa nada que toque rede — só a função pura
// guardSharedEnvironment(), com process.exit/console.error substituídos
// por captura em memória.
const assert = require('assert');
const { guardSharedEnvironment, isTargetingSharedProjectByUrl, isTargetingLiveBackendByUrl } = require('./_lib/guard-shared-environment');

const results = {};
const originalExit = process.exit;
const originalError = console.error;

function runGuardCapturingExit(opts) {
  let exitCode = null;
  let errorMessage = null;
  process.exit = (code) => { exitCode = code; throw { __guardExit: true }; };
  console.error = (msg) => { errorMessage = msg; };
  try {
    guardSharedEnvironment(opts);
    return { blocked: false, exitCode: null, errorMessage: null };
  } catch (e) {
    if (e && e.__guardExit) return { blocked: true, exitCode, errorMessage };
    throw e;
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }
}

function withEnv(vars, fn) {
  const previous = {};
  for (const k of Object.keys(vars)) previous[k] = process.env[k];
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    }
  }
}

function main() {
  // 1) Helpers puros de detecção de URL
  assert.equal(isTargetingSharedProjectByUrl('https://usihurogvphtjedyhyfl.supabase.co'), true);
  assert.equal(isTargetingSharedProjectByUrl('https://lhzsbgsnmpkqqkdxvkue.supabase.co'), false);
  assert.equal(isTargetingSharedProjectByUrl(''), false);
  assert.equal(isTargetingLiveBackendByUrl('https://mdoctor-backend-staging-staging.up.railway.app'), true);
  assert.equal(isTargetingLiveBackendByUrl('http://localhost:3000'), false);
  assert.equal(isTargetingLiveBackendByUrl(''), false);
  results.helpersPurosDeDeteccaoDeUrl = 'ok';

  // 2) SUPABASE_URL isolado (staging de verdade) nunca bloqueia, mesmo sem
  //    nenhuma confirmação — não há nada a confirmar.
  withEnv({
    SUPABASE_URL: 'https://lhzsbgsnmpkqqkdxvkue.supabase.co',
    ALLOW_SHARED_PROD_STAGING_DB: '',
    CONFIRM_SUPABASE_PROJECT_REF: ''
  }, () => {
    const r = runGuardCapturingExit({ context: 'teste' });
    assert.equal(r.blocked, false);
  });
  results.supabaseUrlIsoladoNuncaBloqueia = 'ok';

  // 3) Projeto compartilhado SEM nenhuma confirmação -> bloqueia (exit 1,
  //    nunca lança — não pode ser engolido por um try/catch do chamador).
  withEnv({
    SUPABASE_URL: 'https://usihurogvphtjedyhyfl.supabase.co',
    ALLOW_SHARED_PROD_STAGING_DB: '',
    CONFIRM_SUPABASE_PROJECT_REF: ''
  }, () => {
    const r = runGuardCapturingExit({ context: 'teste' });
    assert.equal(r.blocked, true);
    assert.equal(r.exitCode, 1);
    assert.ok(r.errorMessage.includes('usihurogvphtjedyhyfl'));
  });
  results.bloqueiaQuandoAllowAusente = 'ok';

  // 4) Projeto compartilhado com ALLOW=true mas SEM o project ref esperado
  //    (ou com o ref errado/digitado errado) -> continua bloqueando. Esta é
  //    a defesa contra um ALLOW=true residual de outra sessão/script.
  withEnv({
    SUPABASE_URL: 'https://usihurogvphtjedyhyfl.supabase.co',
    ALLOW_SHARED_PROD_STAGING_DB: 'true',
    CONFIRM_SUPABASE_PROJECT_REF: ''
  }, () => {
    const r = runGuardCapturingExit({ context: 'teste' });
    assert.equal(r.blocked, true, 'ALLOW=true sozinho, sem o project ref confirmado, não deve liberar');
  });
  withEnv({
    SUPABASE_URL: 'https://usihurogvphtjedyhyfl.supabase.co',
    ALLOW_SHARED_PROD_STAGING_DB: 'true',
    CONFIRM_SUPABASE_PROJECT_REF: 'projeto-errado-ou-digitado-errado'
  }, () => {
    const r = runGuardCapturingExit({ context: 'teste' });
    assert.equal(r.blocked, true, 'project ref que não corresponde ao esperado não deve liberar mesmo com ALLOW=true');
  });
  results.bloqueiaQuandoProjectRefNaoCorresponde = 'ok';

  // 5) Só libera com as DUAS confirmações presentes e corretas ao mesmo
  //    tempo — simulado inteiramente em memória, nenhuma chamada real.
  withEnv({
    SUPABASE_URL: 'https://usihurogvphtjedyhyfl.supabase.co',
    ALLOW_SHARED_PROD_STAGING_DB: 'true',
    CONFIRM_SUPABASE_PROJECT_REF: 'usihurogvphtjedyhyfl'
  }, () => {
    const r = runGuardCapturingExit({ context: 'teste' });
    assert.equal(r.blocked, false, 'as duas confirmações corretas juntas devem liberar');
  });
  results.permiteSoComAsDuasConfirmacoesCorretasJuntas = 'ok';

  // 6) urlsToCheck (ex.: BACKEND_URL de staging real) segue a mesma regra de
  //    dupla confirmação.
  withEnv({ SUPABASE_URL: '', ALLOW_SHARED_PROD_STAGING_DB: '', CONFIRM_SUPABASE_PROJECT_REF: '' }, () => {
    const blocked = runGuardCapturingExit({ context: 'teste', urlsToCheck: ['https://mdoctor-backend-staging-staging.up.railway.app'] });
    assert.equal(blocked.blocked, true);
  });
  withEnv({ SUPABASE_URL: '', ALLOW_SHARED_PROD_STAGING_DB: 'true', CONFIRM_SUPABASE_PROJECT_REF: 'usihurogvphtjedyhyfl' }, () => {
    const allowed = runGuardCapturingExit({ context: 'teste', urlsToCheck: ['https://mdoctor-backend-staging-staging.up.railway.app'] });
    assert.equal(allowed.blocked, false);
  });
  results.urlsToCheckSeguemAMesmaRegraDeDuplaConfirmacao = 'ok';

  // 7) urlsToCheck com localhost nunca bloqueia (nada a confirmar).
  withEnv({ SUPABASE_URL: '', ALLOW_SHARED_PROD_STAGING_DB: '', CONFIRM_SUPABASE_PROJECT_REF: '' }, () => {
    const r = runGuardCapturingExit({ context: 'teste', urlsToCheck: ['http://localhost:3000'] });
    assert.equal(r.blocked, false);
  });
  results.urlsToCheckComLocalhostNuncaBloqueia = 'ok';

  // 8) Nomes de variável customizados são respeitados nos dois lados da
  //    dupla confirmação.
  withEnv({
    SUPABASE_URL: 'https://usihurogvphtjedyhyfl.supabase.co',
    MINHA_CONFIRMACAO: 'true',
    MEU_REF_ESPERADO: 'usihurogvphtjedyhyfl'
  }, () => {
    const r = runGuardCapturingExit({
      context: 'teste',
      envVarName: 'MINHA_CONFIRMACAO',
      expectedProjectRefEnvVarName: 'MEU_REF_ESPERADO'
    });
    assert.equal(r.blocked, false);
  });
  results.nomesDeVariavelCustomizadosRespeitadosNosDoisLados = 'ok';

  console.log(JSON.stringify(results, null, 2));
}

main();
