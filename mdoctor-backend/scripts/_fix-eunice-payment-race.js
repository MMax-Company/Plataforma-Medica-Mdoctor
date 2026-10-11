// DANGEROUS / MANUAL USE ONLY — script histórico de recuperação pontual de
// incidente, não é teste automatizado.
require('./load-dotenv');

// load-dotenv.js nunca sobrescreve uma variável já presente no processo (por
// design, para os scripts de E2E de staging que injetam credenciais via
// shell) — mas isso também significa que uma variável residual de uma sessão
// anterior do terminal (mesmo vazia) bloqueia silenciosamente o valor real do
// .env, e o Supabase acaba não inicializando sem nenhum erro explícito nesse
// ponto. Como este script deve rodar isolado, só com o .env do projeto, força
// a leitura direta do arquivo para as duas chaves obrigatórias.
(function forceSupabaseEnvFromDotenv() {
  const fs = require('fs');
  const path = require('path');
  const REQUIRED_KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  for (const file of ['../.env', '../.env.local']) {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) continue;
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      const eq = trimmed.indexOf('=');
      if (eq < 1 || trimmed.startsWith('#')) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!REQUIRED_KEYS.includes(key)) continue;
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (val) process.env[key] = val;
    }
  }
})();

require('./_lib/guard-shared-environment').guardSharedEnvironment({ context: '_fix-eunice-payment-race.js' });

const { initSupabase, getSupabaseStatus } = require('../src/config/supabase');
const { getAtendimento, updateAtendimentoStatus, STATUS } = require('../src/store/atendimentos.store');
const { isExternalUploadEnabled } = require('../src/services/prescription-upload-token.service');
initSupabase();

const supabaseStatus = getSupabaseStatus();
if (!supabaseStatus.responding) {
  console.error(JSON.stringify({ ok: false, error: 'supabase_init_failed', status: supabaseStatus }));
  process.exit(1);
}

// Achado em 27/07: rodar sem argumento caía num ID hardcoded (o atendimento
// real e já concluído da Eunice), reaplicando a reconciliação de
// pagamento_pendente sobre um fluxo já entregue e regredindo o status.
// Este script nunca mais deve ter um ID padrão — precisa ser sempre explícito.
const ATENDIMENTO_ID = process.argv[2];
if (!ATENDIMENTO_ID) {
  console.error(
    JSON.stringify({
      ok: false,
      error: 'missing_atendimento_id',
      message: 'Uso obrigatório: node scripts/_fix-eunice-payment-race.js <ATENDIMENTO_ID>'
    })
  );
  process.exit(1);
}

// Estados terminais (fluxo já encerrado) nunca podem ser alvo desta
// reconciliação — ela existe só para destravar atendimentos presos em
// "rejeitado por pagamento_pendente", nunca para reabrir um caso já
// entregue ou já rejeitado definitivamente.
const TERMINAL_STATUSES = new Set([STATUS.DELIVERED, STATUS.REJECTED]);

async function main() {
  const previous = await getAtendimento(ATENDIMENTO_ID);
  if (!previous) {
    console.error(JSON.stringify({ ok: false, error: 'not_found', atendimentoId: ATENDIMENTO_ID }));
    process.exit(1);
  }
  console.log('ANTES:', JSON.stringify({ status: previous.status, elegibilidade: previous.elegibilidade }, null, 2));

  if (TERMINAL_STATUSES.has(previous.status)) {
    console.error(
      JSON.stringify({
        ok: false,
        error: 'terminal_status_not_reconcilable',
        atendimentoId: ATENDIMENTO_ID,
        status: previous.status,
        message: `Atendimento já está em estado terminal ("${previous.status}") — fluxo encerrado, reconciliação não pode ser aplicada.`
      })
    );
    process.exit(1);
  }

  const externalUpload = isExternalUploadEnabled();
  const nextStatus = externalUpload ? STATUS.AWAITING_PRESCRIPTION_UPLOAD : STATUS.WAITING;
  const motivoReconciliacao =
    'Reconciliação manual: pagamento Stripe confirmado 2s após rejeição automática por pagamento_pendente (mesma condição de corrida documentada, mecanismo automático não cobriu o fluxo de pagamento via link Typebot)';

  const updated = await updateAtendimentoStatus(ATENDIMENTO_ID, nextStatus, {
    motivo: motivoReconciliacao,
    pagamento_status: 'CONFIRMADO',
    dados_clinicos: {
      ...(previous.dados_clinicos || {}),
      pagamento_status: 'CONFIRMADO',
      payment_status: 'paid',
      payment_confirmed: true,
      manual_reconciliation: {
        reconciled_at: new Date().toISOString(),
        reason: 'stripe_payment_confirmed_after_rejection',
        previous_status: previous.status
      }
    },
    elegibilidade: {
      ...(previous.elegibilidade || {}),
      eligible: true,
      reason: 'Pagamento confirmado (reconciliação manual)',
      reasonCode: null,
      riskLevel: previous.elegibilidade?.riskLevel === 'BLOQUEADO' ? null : previous.elegibilidade?.riskLevel
    }
  });

  console.log('DEPOIS:', JSON.stringify({ status: updated?.status, pagamento_status: updated?.pagamento_status, elegibilidade: updated?.elegibilidade }, null, 2));

  console.log(
    JSON.stringify({
      ok: true,
      event: 'reconciliacao_pagamento_pendente_aplicada',
      atendimentoId: ATENDIMENTO_ID,
      statusAnterior: previous.status,
      statusFinal: updated?.status,
      motivo: motivoReconciliacao,
      timestamp: new Date().toISOString()
    })
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(JSON.stringify({ ok: false, error: e.message, stack: e.stack }));
    process.exit(1);
  });
