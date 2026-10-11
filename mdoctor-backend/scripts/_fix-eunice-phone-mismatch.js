// DANGEROUS / MANUAL USE ONLY — script histórico de recuperação pontual de
// incidente, não é teste automatizado.
require('./load-dotenv');
require('./_lib/guard-shared-environment').guardSharedEnvironment({ context: '_fix-eunice-phone-mismatch.js' });
const { initSupabase } = require('../src/config/supabase');
const { getAtendimento, updateAtendimentoStatus } = require('../src/store/atendimentos.store');
initSupabase();

const ATENDIMENTO_ID = process.argv[2];
const REAL_PHONE = process.argv[3];

async function main() {
  if (!ATENDIMENTO_ID || !REAL_PHONE) {
    console.error(JSON.stringify({ ok: false, error: 'uso: node _fix-eunice-phone-mismatch.js <atendimentoId> <telefoneReal>' }));
    process.exit(1);
  }
  const previous = await getAtendimento(ATENDIMENTO_ID);
  console.log('ANTES:', previous?.paciente_telefone);

  const updated = await updateAtendimentoStatus(ATENDIMENTO_ID, previous.status, {
    motivo: 'Correcao manual: telefone gravado tinha o 9o digito, mas o WhatsApp real da paciente envia sem ele (formato antigo) — findPendingUploadContext nao casava',
    paciente_telefone: REAL_PHONE
  });

  console.log('DEPOIS:', updated?.paciente_telefone);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(JSON.stringify({ ok: false, error: e.message, stack: e.stack }));
    process.exit(1);
  });
