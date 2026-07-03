-- Consolidação técnica Supabase (2026-07-03)
-- Fecha lacuna de RLS em patient_outcomes e adiciona índices ausentes em FKs
-- de tabelas ativamente usadas pelo backend. Não altera dados nem remove nada.

-- ---------------------------------------------------------------------------
-- RLS ausente: patient_outcomes (migration 20260607 esqueceu de habilitar)
-- ---------------------------------------------------------------------------
alter table public.patient_outcomes enable row level security;

drop policy if exists "service_role_all_patient_outcomes" on public.patient_outcomes;
create policy "service_role_all_patient_outcomes"
  on public.patient_outcomes for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Índices ausentes em colunas de FK (tabelas com uso real no backend)
-- ---------------------------------------------------------------------------
create index if not exists idx_medical_decisions_appointment on public.medical_decisions(appointment_id);
create index if not exists idx_medical_records_appointment on public.medical_records(appointment_id);
create index if not exists idx_medical_records_patient on public.medical_records(patient_id);
create index if not exists idx_prescription_delivery_appointment on public.prescription_delivery(appointment_id);
create index if not exists idx_prescription_delivery_prescription on public.prescription_delivery(prescription_id);
create index if not exists idx_payments_appointment on public.payments(appointment_id);
create index if not exists idx_payments_patient on public.payments(patient_id);
create index if not exists idx_payment_events_payment on public.payment_events(payment_id);
create index if not exists idx_typebot_sessions_appointment on public.typebot_sessions(appointment_id);
create index if not exists idx_typebot_sessions_patient on public.typebot_sessions(patient_id);
create index if not exists idx_whatsapp_messages_session on public.whatsapp_messages(session_id);
create index if not exists idx_whatsapp_messages_appointment on public.whatsapp_messages(appointment_id);
create index if not exists idx_support_messages_ticket on public.support_messages(ticket_id);
create index if not exists idx_n8n_events_appointment on public.n8n_events(appointment_id);
