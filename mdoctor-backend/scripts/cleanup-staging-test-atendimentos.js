#!/usr/bin/env node
/**
 * Limpeza única de atendimentos de teste/técnicos no ambiente real (staging
 * e produção compartilham o mesmo Supabase — não há tabela separada).
 *
 * Classificação revisada manualmente com o usuário em 26/07: 52 registros
 * técnicos (nomes/CPFs/emails sintéticos de scripts de homologação) contra
 * 20 registros humanos reais preservados (Mary Helen Maia Mathias, Willian
 * Bezerra dos Santos, Max Vinicius Ferreira Matos e variações do nome, e
 * "Suporte WhatsApp 5777" — mantido por decisão explícita do usuário mesmo
 * sendo um registro de fila, não uma consulta médica).
 *
 * Uso:
 *   node scripts/cleanup-staging-test-atendimentos.js --dry-run   (padrão)
 *   node scripts/cleanup-staging-test-atendimentos.js --execute   (apaga de fato)
 */
require('./load-dotenv');
require('./_lib/guard-shared-environment').guardSharedEnvironment({ context: 'cleanup-staging-test-atendimentos.js' });
const { getSupabase, initSupabase } = require('../src/config/supabase');
const { listAtendimentos } = require('../src/store/atendimentos.store');
const { getAppointmentTable } = require('../src/db/resolve-tables');
initSupabase();
const TEST_CPF = '12345678909';
const ALL_SAME_DIGIT_CPF = /^(\d)\1{10}$/;
const TEST_NAME_PATTERNS = [
  /paciente\s*fase\s*2/i,
  /paciente\s*verificacao\s*memed/i,
  /\bteste\b/i,
  /\btest\b/i,
  /fict[ií]cio/i,
  /\bmock\b/i,
  /\bhomologa/i,
  /simula[cç][aã]o/i,
  /qa\s*test/i,
  /upload\s*context/i,
  /reprova(cao|ç[aã]o)\s*v\d/i,
  /^probe$/i,
  /^prodprobe$/i,
  /^urlcheck$/i,
  /check\s*(final\s*)?staging/i,
  /paciente\s*validacao\s*staging/i,
];
const TEST_EMAIL_PATTERNS = [/@example\.com$/i, /fase2\./i, /memed\.verif/i, /\.local$/i, /qa\+/i];

// Exceção explícita — decisão do usuário em 26/07: manter mesmo sendo um
// registro de fila de suporte, não uma consulta médica.
const KEEP_IDS = new Set();
const KEEP_NAME_EXACT = new Set(['Suporte WhatsApp 5777']);

function classify(row) {
  if (KEEP_IDS.has(row.id) || KEEP_NAME_EXACT.has(row.paciente_nome)) return { isTest: false, reasons: [] };
  const reasons = [];
  const name = row.paciente_nome || '';
  const cpf = (row.paciente_cpf || '').replace(/\D/g, '');
  const email = row.paciente_email || '';

  if (cpf === TEST_CPF) reasons.push('cpf_teste');
  if (cpf && ALL_SAME_DIGIT_CPF.test(cpf)) reasons.push('cpf_repetido');
  for (const p of TEST_NAME_PATTERNS) if (p.test(name)) reasons.push(`nome:${p}`);
  for (const p of TEST_EMAIL_PATTERNS) if (p.test(email)) reasons.push(`email:${p}`);

  return { isTest: reasons.length > 0, reasons };
}

async function main() {
  const execute = process.argv.includes('--execute');
  const supabase = getSupabase();
  const table = await getAppointmentTable();

  const rows = await listAtendimentos();

  const toDelete = [];
  const toKeep = [];
  for (const row of rows) {
    const { isTest, reasons } = classify(row);
    if (isTest) toDelete.push({ ...row, _reasons: reasons });
    else toKeep.push(row);
  }

  console.log(`Total no banco: ${rows.length}`);
  console.log(`Classificados como TESTE (${execute ? 'SERÃO REMOVIDOS' : 'seriam removidos'}): ${toDelete.length}`);
  console.log(`Classificados como REAIS (preservados): ${toKeep.length}\n`);

  console.log('--- REAIS PRESERVADOS ---');
  for (const r of toKeep) console.log(`  ${r.paciente_nome} | ${r.criado_em}`);

  console.log('\n--- TESTE (candidatos à remoção) ---');
  for (const r of toDelete) console.log(`  ${r.paciente_nome} | ${r.criado_em}`);

  if (!execute) {
    console.log('\n[DRY-RUN] Nada foi apagado. Rode com --execute para aplicar de fato.');
    return;
  }

  const ids = toDelete.map((r) => r.id);
  const { error: delError, count } = await supabase.from(table).delete({ count: 'exact' }).in('id', ids);
  if (delError) {
    console.error(JSON.stringify({ ok: false, error: delError.message }));
    process.exit(1);
  }

  const { count: remainingCount, error: countError } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true });
  console.log(`\nRemovidos: ${count ?? ids.length}`);
  console.log(`Restantes no banco: ${countError ? '(erro ao contar: ' + countError.message + ')' : remainingCount}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(JSON.stringify({ ok: false, error: e.message, stack: e.stack }));
    process.exit(1);
  });
