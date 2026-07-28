// Inspeciona (somente leitura) as sessões whatsapp_sessions cujo metadata
// tem typebot_expected_input_id preso no choice "Vamos começar" — usado
// para confirmar empiricamente a hipotese de causa raiz do bug de
// roteamento pos-finalizacao de suporte relatado em 2026-07-28.
require('dotenv').config();
const { initSupabase } = require('../src/config/supabase');
initSupabase();
const { dbQuery } = require('../src/db/persistence');
const T = require('../src/db/tables');

const WELCOME_CHOICE_INPUT_ID = 'sbjZWLJGVkHAkDqS4JQeGow';

async function main() {
  const rows = await dbQuery('listar whatsapp sessions', async (supabase) =>
    supabase.from(T.WHATSAPP_SESSIONS).select('*').order('updated_at', { ascending: false }).limit(50)
  );

  const stuck = (rows || []).filter((r) => r.metadata?.typebot_expected_input_id === WELCOME_CHOICE_INPUT_ID);
  console.log(`Total de sessões inspecionadas: ${(rows || []).length}`);
  console.log(`Sessões presas em WELCOME_CHOICE_INPUT_ID: ${stuck.length}`);
  for (const s of stuck) {
    console.log(`  phone=${String(s.phone || '').replace(/\d(?=\d{4})/g, '*')} typebot_session_id=${s.typebot_session_id} updated_at=${s.updated_at}`);
  }

  // Também lista atendimentos de suporte com support_sub_status atual, para
  // ver se algum está em awaiting_patient_decision agora.
  const { listAtendimentos } = require('../src/store/atendimentos.store');
  const all = await listAtendimentos();
  const supportRows = all.filter((a) => a.condicao === 'suporte_whatsapp');
  console.log(`\nTickets de suporte encontrados: ${supportRows.length}`);
  for (const a of supportRows) {
    console.log(`  id=${a.id} status=${a.status} sub=${a.dados_clinicos?.support_sub_status || '(none)'} phone=${String(a.paciente_telefone || '').replace(/\d(?=\d{4})/g, '*')}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FALHOU:', err.message, err.stack);
    process.exit(1);
  });
