-- Migration incremental — NÃO altera 20261010120000_support_chat_v1.sql (já
-- aplicada/reconciliada). Achado do advisor de performance (ETAPA 3,
-- 10/10/2026): support_conversations.patient_id tem FK sem índice de
-- cobertura. appointment_id já é indexado pelo unique constraint da coluna;
-- patient_id não tinha nenhum índice.
create index if not exists support_conversations_patient_id_idx
  on public.support_conversations(patient_id);
