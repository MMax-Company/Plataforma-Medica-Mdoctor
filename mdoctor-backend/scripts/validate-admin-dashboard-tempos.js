// Validação manual (não é teste automatizado) dos indicadores de tempo do
// painel administrativo (/api/admin/dashboard → tempos), rodando a
// correlação real (computeTempos) contra os atendimentos concluídos
// existentes no banco (staging), com detalhe por atendimento para conferência.
require('dotenv').config();
const { initSupabase } = require('../src/config/supabase');
initSupabase();
const { listAtendimentos, listDecisoesLog, STATUS } = require('../src/store/atendimentos.store');
const { computeTempos } = require('../src/routes/admin.routes');

function fmt(iso) {
  return iso ? new Date(iso).toISOString() : '—';
}

async function main() {
  const all = await listAtendimentos();
  const concluidos = all.filter((a) => a.status === STATUS.DELIVERED || a.status === STATUS.REJECTED);

  console.log(`Total de atendimentos: ${all.length}`);
  console.log(`Concluídos (delivered + rejected): ${concluidos.length}\n`);

  console.log('--- Detalhe por atendimento concluído ---');
  for (const a of concluidos) {
    const decisoes = await listDecisoesLog(a.id);
    const emAtendimento = decisoes
      .filter((d) => d.status_novo === STATUS.EM_ATENDIMENTO)
      .sort((x, y) => new Date(x.criado_em) - new Date(y.criado_em));
    const c = a.dados_clinicos || {};

    console.log(`\n[${a.id}] ${a.paciente_nome || '(sem nome)'} — status=${a.status}`);
    console.log(`  criado_em (entrada na fila)........... ${fmt(a.criado_em)}`);
    console.log(`  em_atendimento (clique Atender)........ ${fmt(emAtendimento[0]?.criado_em)}`);
    console.log(`  clinical_audit.approvedAt.............. ${fmt(c.clinical_audit?.approvedAt)}`);
    console.log(`  clinical_audit.rejectedAt.............. ${fmt(c.clinical_audit?.rejectedAt)}`);
    console.log(`  entrega_receita.sent_at................ ${fmt(c.entrega_receita?.sent_at)}`);
    console.log(`  historico_receita.ultimo_envio_em...... ${fmt(c.historico_receita?.ultimo_envio_em)}`);
  }

  const tempos = await computeTempos(all);
  console.log('\n--- Resultado computeTempos() ---');
  console.log(JSON.stringify(tempos, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FALHOU:', err.message, err.stack);
    process.exit(1);
  });
