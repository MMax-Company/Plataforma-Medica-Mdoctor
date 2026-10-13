// Teste offline do scanner de segredos do CI (scripts/check-ci-secrets.js).
// Chama só as funções puras exportadas (scanAddedLine/isRealEnvFile/etc.),
// nunca o `git diff` real — sem rede, sem repositório, sem side effect.
const assert = require('assert');
const { scanAddedLine, isRealEnvFile, isTestFilePath } = require('./check-ci-secrets');

const results = {};

// 1) O falso positivo real que bloqueou o PR #66 deve passar: valor fixo
// começando com `test_`, dentro de um arquivo reconhecido como teste.
{
  const filePath = 'mdoctor-backend/scripts/test-support-chat-authorization.js';
  const line = "process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_support_chat_authz';";
  assert.deepEqual(scanAddedLine(filePath, line), []);
}
results.falsoPositivoConhecidoNaoEhMaisSinalizado = 'ok';

// 2) Um segredo real hardcoded no MESMO arquivo de teste continua
// bloqueando — a isenção nunca vale para valores que não comecem com `test_`.
{
  const filePath = 'mdoctor-backend/scripts/test-support-chat-authorization.js';
  const line = "process.env.JWT_SECRET = 'segredo-real-hardcoded';";
  assert.deepEqual(scanAddedLine(filePath, line), ['JWT secret assignment']);
}
results.segredoRealHardcodedContinuaFalhandoMesmoEmArquivoDeTeste = 'ok';

// 3) O MESMO valor sintético `test_...`, mas em um arquivo que NÃO é
// reconhecido como teste, continua bloqueando — a isenção é restrita por
// arquivo, nunca um allowlist genérico para JWT_SECRET.
{
  const filePath = 'mdoctor-backend/src/config/jwt.js';
  const line = "JWT_SECRET = 'test_qualquer_coisa';";
  assert.deepEqual(scanAddedLine(filePath, line), ['JWT secret assignment']);
}
results.valorSinteticoForaDeArquivoDeTesteContinuaFalhando = 'ok';

// 4) Demais padrões de segredo continuam intactos, em qualquer arquivo,
// inclusive dentro de um arquivo de teste (a isenção é específica do padrão
// "JWT secret assignment", nunca genérica).
{
  const filePath = 'mdoctor-backend/scripts/test-qualquer-coisa.js';
  assert.deepEqual(scanAddedLine(filePath, 'const k = "sk_live_abcDEF123456";'), ['Stripe secret key']);
  assert.deepEqual(scanAddedLine(filePath, 'const w = "whsec_abcDEF123456";'), ['Stripe webhook secret']);
  assert.deepEqual(
    scanAddedLine(filePath, 'const t = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123";'),
    ['JWT token']
  );
  assert.deepEqual(
    scanAddedLine(filePath, "SUPABASE_SERVICE_ROLE_KEY = 'qualquer-coisa';"),
    ['Supabase service key assignment']
  );
  assert.deepEqual(
    scanAddedLine(filePath, "MEMED_SECRET_KEY = 'qualquer-coisa';"),
    ['Memed secret assignment']
  );
  assert.deepEqual(scanAddedLine(filePath, 'MEDICO_PASS = admin123'), ['Default medical password']);
}
results.demaisPadroesDeSegredoContinuamIntactos = 'ok';

// 5) Linha sem nenhum padrão não gera achado.
{
  assert.deepEqual(scanAddedLine('qualquer/arquivo.js', 'const x = 1;'), []);
}
results.linhaSemPadraoNaoGeraAchado = 'ok';

// 6) isTestFilePath: só reconhece os formatos esperados (scripts/test-*.js,
// *.test.js, __tests__/*), nunca um arquivo qualquer.
{
  assert.equal(isTestFilePath('mdoctor-backend/scripts/test-support-chat-authorization.js'), true);
  assert.equal(isTestFilePath('src/foo.test.js'), true);
  assert.equal(isTestFilePath('__tests__/foo.js'), true);
  assert.equal(isTestFilePath('mdoctor-backend/src/config/jwt.js'), false);
  assert.equal(isTestFilePath('mdoctor-backend/scripts/attestado.js'), false);
}
results.isTestFilePathReconheceSoOsFormatosEsperados = 'ok';

// 7) isRealEnvFile inalterado: só bloqueia .env real, nunca .env.example.
{
  assert.equal(isRealEnvFile('.env'), true);
  assert.equal(isRealEnvFile('mdoctor-backend/.env.local'), true);
  assert.equal(isRealEnvFile('mdoctor-backend/.env.example'), false);
}
results.isRealEnvFileInalterado = 'ok';

console.log(JSON.stringify(results, null, 2));
