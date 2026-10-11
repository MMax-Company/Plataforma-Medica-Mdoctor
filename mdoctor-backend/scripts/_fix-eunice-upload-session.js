// DANGEROUS / MANUAL USE ONLY — script histórico de recuperação pontual de
// incidente, não é teste automatizado.
require('./load-dotenv');
require('./_lib/guard-shared-environment').guardSharedEnvironment({ context: '_fix-eunice-upload-session.js' });
const { initSupabase } = require('../src/config/supabase');
const { createPrescriptionUploadSession } = require('../src/services/prescription-upload-token.service');
initSupabase();

const ATENDIMENTO_ID = process.argv[2];

async function main() {
  if (!ATENDIMENTO_ID) {
    console.error(JSON.stringify({ ok: false, error: 'informe o atendimentoId como argumento' }));
    process.exit(1);
  }
  const session = await createPrescriptionUploadSession({ atendimentoId: ATENDIMENTO_ID, correlationId: 'manual-fix-eunice' });
  console.log(JSON.stringify({ ok: true, atendimentoId: ATENDIMENTO_ID, token: session.token, uploadUrl: session.uploadUrl }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(JSON.stringify({ ok: false, error: e.message, stack: e.stack }));
    process.exit(1);
  });
