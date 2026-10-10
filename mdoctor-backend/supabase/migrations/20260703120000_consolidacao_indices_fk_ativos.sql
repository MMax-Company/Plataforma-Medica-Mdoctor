-- Consolidação técnica Supabase (2026-07-03) — parte 2
-- Índices adicionais em FKs de tabelas com uso real (advisor de performance)
-- e correção de search_path mutável na função de trigger (advisor de segurança).

create index if not exists idx_appointment_status_history_appointment on public.appointment_status_history(appointment_id);
create index if not exists idx_prescriptions_patient on public.prescriptions(patient_id);
create index if not exists idx_triage_sessions_appointment on public.triage_sessions(appointment_id);
create index if not exists idx_triage_answers_session on public.triage_answers(triage_session_id);
create index if not exists idx_whatsapp_sessions_patient on public.whatsapp_sessions(patient_id);
create index if not exists idx_support_tickets_appointment on public.support_tickets(appointment_id);
create index if not exists idx_support_tickets_patient on public.support_tickets(patient_id);
create index if not exists idx_patient_addresses_patient on public.patient_addresses(patient_id);
create index if not exists idx_patient_documents_patient on public.patient_documents(patient_id);

-- Corrige search_path mutável na função de trigger (lint de segurança)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;
