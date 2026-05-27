create extension if not exists "pgcrypto";

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  nome text not null default '',
  telefone text not null default '',
  email text not null default '',
  cpf text not null default '',
  data_nascimento text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.atendimentos (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(id) on delete set null,
  paciente_nome text not null default '',
  paciente_telefone text not null default '',
  paciente_email text not null default '',
  paciente_cpf text not null default '',
  condicao text not null default '',
  origem text not null default 'backend',
  status text not null default 'waiting',
  pagamento_status text not null default 'PENDENTE',
  risco text not null default 'BAIXO',
  elegibilidade jsonb,
  dados_clinicos jsonb not null default '{}'::jsonb,
  medicacao_em_uso text not null default '',
  motivo_decisao text,
  medico_id text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  atendimento_id uuid references public.atendimentos(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  status text not null default 'mock',
  provider text not null default 'mock',
  provider_prescription_id text,
  pdf_url text,
  medications jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  actor text not null default 'backend',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_atendimentos_status on public.atendimentos(status);
create index if not exists idx_atendimentos_patient_id on public.atendimentos(patient_id);
create index if not exists idx_prescriptions_atendimento_id on public.prescriptions(atendimento_id);
create index if not exists idx_audit_logs_entity_id on public.audit_logs(entity_id);

alter table public.patients enable row level security;
alter table public.atendimentos enable row level security;
alter table public.prescriptions enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "backend service role patients" on public.patients;
create policy "backend service role patients"
  on public.patients
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "backend service role atendimentos" on public.atendimentos;
create policy "backend service role atendimentos"
  on public.atendimentos
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "backend service role prescriptions" on public.prescriptions;
create policy "backend service role prescriptions"
  on public.prescriptions
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "backend service role audit_logs" on public.audit_logs;
create policy "backend service role audit_logs"
  on public.audit_logs
  for all
  to service_role
  using (true)
  with check (true);

insert into storage.buckets (id, name, public)
values
  ('documents', 'documents', false),
  ('prescriptions', 'prescriptions', false),
  ('medical-records', 'medical-records', false),
  ('consents', 'consents', false),
  ('logs', 'logs', false)
on conflict (id) do nothing;
