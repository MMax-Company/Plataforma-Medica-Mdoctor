-- Fase 1 — coleta de evidências pós-entrega de receita (MVP)
create table if not exists public.patient_outcomes (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.appointments(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  survey_version text not null default 'fase1_v1',
  q1_access_alternative text,
  q2_avoided_interruption text,
  q3_would_use_again text,
  constraint patient_outcomes_attendance_survey_unique unique (attendance_id, survey_version)
);

create index if not exists patient_outcomes_attendance_id_idx on public.patient_outcomes (attendance_id);
create index if not exists patient_outcomes_patient_id_idx on public.patient_outcomes (patient_id);
create index if not exists patient_outcomes_created_at_idx on public.patient_outcomes (created_at desc);
