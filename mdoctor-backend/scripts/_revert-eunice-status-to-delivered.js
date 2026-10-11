// DANGEROUS / MANUAL USE ONLY — script histórico de recuperação pontual de
// incidente, não é teste automatizado.
require('./load-dotenv');
require('./_lib/guard-shared-environment').guardSharedEnvironment({ context: '_revert-eunice-status-to-delivered.js' });
const { initSupabase, getSupabaseStatus } = require('../src/config/supabase');
const { getAtendimento, updateAtendimentoStatus, STATUS } = require('../src/store/atendimentos.store');
initSupabase();

const status = getSupabaseStatus();
if (!status.responding) {
  console.error(JSON.stringify({ ok: false, error: 'supabase_init_failed', status }));
  process.exit(1);
}

const ATENDIMENTO_ID = '155fff88-5ead-41da-a5ee-64f85b9e2944';

async function main() {
  const previous = await getAtendimento(ATENDIMENTO_ID);
  if (!previous) {
    console.error(JSON.stringify({ ok: false, error: 'not_found' }));
    process.exit(1);
  }
  console.log('ANTES:', JSON.stringify({ status: previous.status }, null, 2));

  const updated = await updateAtendimentoStatus(ATENDIMENTO_ID, STATUS.DELIVERED, {
    motivo:
      'Correção: reconciliação de pagamento_pendente foi reaplicada indevidamente a este atendimento (script _fix-eunice-payment-race.js executado sem ID explícito, caiu no padrão hardcoded contra um atendimento já concluído). Receita já havia sido emitida e entregue; status revertido para delivered. Dados de pagamento/reconciliação preservados.',
    dados_clinicos: {
      ...(previous.dados_clinicos || {}),
      manual_reconciliation: {
        ...(previous.dados_clinicos?.manual_reconciliation || {}),
        corrected_at: new Date().toISOString(),
        corrected_reason:
          'Reconciliação de pagamento_pendente aplicada indevidamente a atendimento já entregue (execução do script sem ID explícito); status revertido para delivered.'
      }
    }
  });

  console.log('DEPOIS:', JSON.stringify({ status: updated?.status, pagamento_status: updated?.pagamento_status }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
