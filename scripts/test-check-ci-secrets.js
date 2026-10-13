// Teste offline do scanner de segredos do CI (scripts/check-ci-secrets.js).
// Chama só as funções puras exportadas (scanAddedLine/isRealEnvFile/etc.),
// nunca o `git diff` real — sem rede, sem repositório, sem side effect.
//
// IMPORTANTE: os valores de teste abaixo são montados por concatenação
// (frag(...)) em vez de escritos como um literal contíguo. Isso não afrouxa
// nenhum padrão — é só para que o PRÓPRIO texto-fonte deste arquivo (ao ser
// adicionado ao repositório) não contenha, ele mesmo, uma substring que bata
// nos padrões que este teste está verificando. Sem isso, este arquivo de
// teste dispararia o scanner real sobre si mesmo.
const assert = require('assert');
const { scanAddedLine, isRealEnvFile, isTestFilePath } = require('./check-ci-secrets');

function frag(...parts) {
  return parts.join('');
}

// O próprio NOME da variável de ambiente também precisa ser montado por
// partes: "JWT_SECRET" seguido de " = " na mesma linha-fonte é exatamente o
// que o padrão "JWT secret assignment" procura, então deixar esse token
// inteiro ao lado de "=" em qualquer fixture abaixo faria este arquivo
// disparar o scanner sobre si mesmo, independente de frag() nos outros
// pedaços da linha.
const JWT_SECRET_TOKEN = frag('JWT_SEC', 'RET');

const results = {};

// 1) O falso positivo real que bloqueou o PR #66 deve passar: valor fixo
// começando com `test_`, dentro de um arquivo reconhecido como teste.
{
  const filePath = 'mdoctor-backend/scripts/test-support-chat-authorization.js';
  const line = frag(
    'process.env.',
    JWT_SECRET_TOKEN,
    ' = process.env.',
    JWT_SECRET_TOKEN,
    " || '",
    'test_secret_support_chat_authz',
    "';"
  );
  assert.deepEqual(scanAddedLine(filePath, line), []);
}
results.falsoPositivoConhecidoNaoEhMaisSinalizado = 'ok';

// 2) Um segredo real hardcoded no MESMO arquivo de teste continua
// bloqueando — a isenção nunca vale para valores que não comecem com `test_`.
{
  const filePath = 'mdoctor-backend/scripts/test-support-chat-authorization.js';
  const line = frag('process.env.', JWT_SECRET_TOKEN, " = '", 'segredo-real-hardcoded', "';");
  assert.deepEqual(scanAddedLine(filePath, line), ['JWT secret assignment']);
}
results.segredoRealHardcodedContinuaFalhandoMesmoEmArquivoDeTeste = 'ok';

// 3) O MESMO valor sintético `test_...`, mas em um arquivo que NÃO é
// reconhecido como teste, continua bloqueando — a isenção é restrita por
// arquivo, nunca um allowlist genérico para JWT_SECRET.
{
  const filePath = 'mdoctor-backend/src/config/jwt.js';
  const line = frag(JWT_SECRET_TOKEN, ' = ', "'", 'test_qualquer_coisa', "';");
  assert.deepEqual(scanAddedLine(filePath, line), ['JWT secret assignment']);
}
results.valorSinteticoForaDeArquivoDeTesteContinuaFalhando = 'ok';

// 4) Demais padrões de segredo continuam intactos, em qualquer arquivo,
// inclusive dentro de um arquivo de teste (a isenção é específica do padrão
// "JWT secret assignment", nunca genérica).
{
  const filePath = 'mdoctor-backend/scripts/test-qualquer-coisa.js';

  const stripeKeyLine = frag('const k = "', 'sk_live_', 'abcDEF123456', '";');
  assert.deepEqual(scanAddedLine(filePath, stripeKeyLine), ['Stripe secret key']);

  const stripeWebhookLine = frag('const w = "', 'whsec_', 'abcDEF123456', '";');
  assert.deepEqual(scanAddedLine(filePath, stripeWebhookLine), ['Stripe webhook secret']);

  const jwtTokenLine = frag(
    'const t = "',
    'eyJhbGciOiJ',
    'IUzI1NiJ9',
    '.',
    'eyJzdWIiOiIxIn0',
    '.',
    'abc123',
    '";'
  );
  assert.deepEqual(scanAddedLine(filePath, jwtTokenLine), ['JWT token']);

  const supabaseLine = frag('SUPABASE_SERVICE_ROLE_KEY', ' = ', "'", 'qualquer-coisa', "';");
  assert.deepEqual(scanAddedLine(filePath, supabaseLine), ['Supabase service key assignment']);

  const memedLine = frag('MEMED_SECRET_KEY', ' = ', "'", 'qualquer-coisa', "';");
  assert.deepEqual(scanAddedLine(filePath, memedLine), ['Memed secret assignment']);

  const defaultPasswordLine = frag('MEDICO_PASS', ' = ', 'admin123');
  assert.deepEqual(scanAddedLine(filePath, defaultPasswordLine), ['Default medical password']);
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
