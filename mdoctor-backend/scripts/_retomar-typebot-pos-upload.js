// DANGEROUS / MANUAL USE ONLY — script histórico de recuperação pontual de
// incidente (IDs hardcoded de um atendimento/sessão específicos), não é
// teste automatizado.
'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'production';
require('./_lib/guard-shared-environment').guardSharedEnvironment({ context: '_retomar-typebot-pos-upload.js' });

async function main() {
  const { initSupabase } = require('../src/config/supabase');
  initSupabase();

  const TOKEN         = 'CvomJkc5drbnNWiZTvrOO6vEJq7NKuF-msLRIOQEfqw';
  const ATENDIMENTO   = 'a9245f60-b42e-4bab-af3f-dda9635f8d35';
  const SESSION_ID    = 'feaf1518-aab9-4d97-a246-60f21b763f0f';

  const { getUploadStatus, resumeTypebotAfterPrescriptionUpload } =
    require('../src/services/typebot-prescription-upload.service');
  const { getSessionByPhone } = require('../src/store/whatsapp-sessions.store');
  const { getAtendimento } = require('../src/store/atendimentos.store');

  // 1. Confirma que o token pertence ao atendimento esperado
  const status = await getUploadStatus(TOKEN);
  console.log('[retomar] upload status:', JSON.stringify(status));
  if (status.atendimento_id !== ATENDIMENTO) {
    throw new Error(`Token aponta para atendimento ${status.atendimento_id}, esperado ${ATENDIMENTO}`);
  }
  if (!status.upload_completed) {
    throw new Error('Upload ainda não concluído — nada a retomar');
  }
  console.log('[retomar] ✅ token válido e upload concluído — atendimento correto');

  // 2. Confirma sessão e typebot_session_id
  const atend = await getAtendimento(ATENDIMENTO);
  const session = await getSessionByPhone(atend.paciente_telefone);
  console.log('[retomar] session.id:', session?.id);
  console.log('[retomar] typebot_session_id:', session?.typebot_session_id);
  console.log('[retomar] expected_input_id:', session?.metadata?.typebot_expected_input_id);
  console.log('[retomar] resume anterior token:', session?.metadata?.prescription_upload_resume?.token);
  console.log('[retomar] resume anterior completed_at:', session?.metadata?.prescription_upload_resume?.completed_at);

  if (session?.id !== SESSION_ID) {
    throw new Error(`Sessão encontrada ${session?.id} difere da esperada ${SESSION_ID}`);
  }

  // 3. Executa retomada — uma única vez
  console.log('[retomar] Chamando resumeTypebotAfterPrescriptionUpload...');
  const result = await resumeTypebotAfterPrescriptionUpload({
    token: TOKEN,
    atendimentoId: ATENDIMENTO,
    correlationId: `recovery-${SESSION_ID}-${Date.now()}`
  });

  console.log('[retomar] Resultado:', JSON.stringify(result));

  // 4. Lê estado final da sessão
  const sessionAfter = await getSessionByPhone(atend.paciente_telefone);
  console.log('[retomar] expected_input depois:', sessionAfter?.metadata?.typebot_expected_input_id);
  console.log('[retomar] resume completed_at depois:', sessionAfter?.metadata?.prescription_upload_resume?.completed_at);

  // 5. Atendimento final
  const atendAfter = await getAtendimento(ATENDIMENTO);
  console.log('[retomar] atendimento status depois:', atendAfter?.status);
}

main().catch((err) => {
  console.error('[retomar] ❌', err.message);
  process.exit(1);
});
