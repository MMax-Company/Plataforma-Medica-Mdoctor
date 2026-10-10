-- Doctor Prescreve — schema oficial de produção (definitivo)
-- Aplicar em projeto Supabase NOVO. Não usar fallback in-memory no backend.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Evolução da tabela patients legada → schema oficial
-- ---------------------------------------------------------------------------
alter table if exists public.patients add column if not exists full_name text not null default '';
alter table if exists public.patients add column if not exists phone text not null default '';
alter table if exists public.patients add column if not exists birth_date text not null default '';
alter table if exists public.patients add column if not exists status text not null default 'pending';
alter table if exists public.patients add column if not exists source text not null default 'panel';
alter table if exists public.patients add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table if exists public.patients add column if not exists deleted_at timestamptz;
alter table if exists public.patients add column if not exists updated_at timestamptz not null default timezone('utc', now());

update public.patients
set
  full_name = coalesce(nullif(full_name, ''), nome, ''),
  phone = coalesce(nullif(phone, ''), telefone, ''),
  birth_date = coalesce(nullif(birth_date, ''), data_nascimento, '')
where exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'patients' and column_name = 'nome'
);

-- ---------------------------------------------------------------------------
-- Pacientes
-- ---------------------------------------------------------------------------
create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null default '',
  phone text not null default '',
  email text not null default '',
  cpf text not null default '',
  birth_date text not null default '',
  status text not null default 'pending',
  source text not null default 'panel',
  metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.patient_addresses (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  street text not null default '',
  number text not null default '',
  complement text not null default '',
  neighborhood text not null default '',
  city text not null default '',
  state text not null default '',
  postal_code text not null default '',
  country text not null default 'BR',
  is_primary boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.patient_documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  document_type text not null,
  document_number text not null default '',
  storage_path text,
  metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- Protocolos e elegibilidade
-- ---------------------------------------------------------------------------
create table if not exists public.medical_protocols (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  version text not null default '1.0',
  rules jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- Triagem
-- ---------------------------------------------------------------------------
create table if not exists public.triage_sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(id) on delete set null,
  appointment_id uuid,
  source text not null default 'typebot',
  status text not null default 'open',
  correlation_id text,
  idempotency_key text unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.triage_answers (
  id uuid primary key default gen_random_uuid(),
  triage_session_id uuid not null references public.triage_sessions(id) on delete cascade,
  question_key text not null,
  answer_value text not null default '',
  answer_json jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- Appointments (substitui atendimentos)
-- ---------------------------------------------------------------------------
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(id) on delete set null,
  patient_name text not null default '',
  patient_phone text not null default '',
  patient_cpf text not null default '',
  patient_email text not null default '',
  condition text not null default '',
  medication_in_use text not null default '',
  source text not null default 'backend',
  status text not null default 'waiting',
  payment_status text not null default 'PENDENTE',
  risk_level text not null default 'BAIXO',
  eligibility jsonb,
  clinical_data jsonb not null default '{}'::jsonb,
  decision_reason text,
  doctor_id text,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.triage_sessions
  drop constraint if exists triage_sessions_appointment_id_fkey;
alter table public.triage_sessions
  add constraint triage_sessions_appointment_id_fkey
  foreign key (appointment_id) references public.appointments(id) on delete set null;

create table if not exists public.medical_eligibility (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  protocol_id uuid references public.medical_protocols(id) on delete set null,
  eligible boolean not null,
  reason text,
  reason_code text,
  criteria_used jsonb not null default '[]'::jsonb,
  protocol_version text,
  risk_level text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.appointment_status_history (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  previous_status text,
  new_status text not null,
  reason text,
  doctor_id text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- Suporte
-- ---------------------------------------------------------------------------
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  channel text not null default 'whatsapp',
  status text not null default 'open',
  priority text not null default 'normal',
  subject text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  closed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null default '',
  provider_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- Pagamentos
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  provider text not null default 'stripe',
  external_id text,
  amount_cents integer,
  currency text not null default 'BRL',
  status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  event_type text not null,
  provider_event_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Evolução prescriptions legada
alter table if exists public.prescriptions add column if not exists appointment_id uuid references public.appointments(id) on delete cascade;
alter table if exists public.prescriptions add column if not exists issued_by_doctor_id text;
alter table if exists public.prescriptions add column if not exists issued_at timestamptz;
alter table if exists public.prescriptions add column if not exists deleted_at timestamptz;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'prescriptions' and column_name = 'atendimento_id'
  ) then
    update public.prescriptions set appointment_id = atendimento_id where appointment_id is null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Receitas
-- ---------------------------------------------------------------------------
create table if not exists public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references public.appointments(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  status text not null default 'draft',
  provider text not null default 'memed',
  provider_prescription_id text,
  pdf_url text,
  medications jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  issued_by_doctor_id text,
  issued_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.prescription_items (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references public.prescriptions(id) on delete cascade,
  drug_name text not null,
  dose text not null default '',
  frequency text not null default '',
  route text not null default 'oral',
  duration text not null default '',
  instructions text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.prescription_delivery (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid references public.prescriptions(id) on delete set null,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  channel text not null default 'whatsapp',
  provider text,
  provider_message_id text,
  status text not null default 'pending',
  target_masked text,
  error_message text,
  snapshot jsonb not null default '{}'::jsonb,
  delivered_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- Prontuário
-- ---------------------------------------------------------------------------
create table if not exists public.medical_records (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  current_version integer not null default 1,
  summary text not null default '',
  clinical_data jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.medical_record_versions (
  id uuid primary key default gen_random_uuid(),
  medical_record_id uuid not null references public.medical_records(id) on delete cascade,
  version integer not null,
  clinical_data jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (medical_record_id, version)
);

create table if not exists public.medical_decisions (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  previous_status text,
  new_status text not null,
  decision_type text not null default 'status_change',
  reason text,
  doctor_id text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.medical_logs (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references public.appointments(id) on delete cascade,
  level text not null default 'info',
  message text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- Auditoria e integrações
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  actor text not null default 'backend',
  origin text not null default 'api',
  ip_address inet,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.integration_logs (
  id uuid primary key default gen_random_uuid(),
  integration text not null,
  direction text not null default 'outbound',
  status text not null default 'ok',
  correlation_id text,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.whatsapp_sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(id) on delete set null,
  phone text not null,
  provider text not null default 'evolution',
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  last_message_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.whatsapp_sessions(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  direction text not null check (direction in ('inbound', 'outbound')),
  phone text not null,
  body text not null default '',
  provider_message_id text,
  status text not null default 'received',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.n8n_events (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text unique,
  source text not null default 'n8n',
  appointment_id uuid references public.appointments(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.typebot_sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  public_id text,
  session_id text,
  status text not null default 'active',
  variables jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.uploaded_files (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  bucket text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.uploaded_prescriptions (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  uploaded_file_id uuid references public.uploaded_files(id) on delete set null,
  token text,
  status text not null default 'pending',
  storage_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- Médicos e sistema
-- ---------------------------------------------------------------------------
create table if not exists public.doctor_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  username text not null unique,
  full_name text not null default '',
  crm text not null default '',
  crm_uf text not null default '',
  email text not null default '',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.doctor_sessions (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctor_profiles(id) on delete cascade,
  token_hash text not null,
  ip_address inet,
  user_agent text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.doctor_permissions (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctor_profiles(id) on delete cascade,
  permission text not null,
  granted boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (doctor_id, permission)
);

create table if not exists public.system_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null default '{}'::jsonb,
  description text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.system_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  severity text not null default 'info',
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.error_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'backend',
  code text,
  message text not null,
  stack text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------------
create index if not exists idx_patients_phone on public.patients(phone);
create index if not exists idx_patients_cpf on public.patients(cpf);
create index if not exists idx_appointments_status on public.appointments(status);
create index if not exists idx_appointments_patient_id on public.appointments(patient_id);
create index if not exists idx_appointments_payment_status on public.appointments(payment_status);
create index if not exists idx_triage_sessions_patient on public.triage_sessions(patient_id);
create index if not exists idx_medical_eligibility_appointment on public.medical_eligibility(appointment_id);
create index if not exists idx_prescriptions_appointment on public.prescriptions(appointment_id);
create index if not exists idx_support_tickets_status on public.support_tickets(status);
create index if not exists idx_audit_logs_entity on public.audit_logs(entity_type, entity_id);
create index if not exists idx_n8n_events_expires on public.n8n_events(expires_at);
create index if not exists idx_whatsapp_messages_phone on public.whatsapp_messages(phone);

-- ---------------------------------------------------------------------------
-- Triggers updated_at
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'patients','patient_addresses','patient_documents','medical_protocols',
    'triage_sessions','triage_answers','appointments','medical_eligibility',
    'appointment_status_history','support_tickets','support_messages',
    'payments','payment_events','prescriptions','prescription_items',
    'prescription_delivery','medical_records','medical_record_versions',
    'medical_decisions','medical_logs','audit_logs','integration_logs',
    'whatsapp_sessions','whatsapp_messages','n8n_events','typebot_sessions',
    'uploaded_files','uploaded_prescriptions','doctor_profiles','doctor_sessions',
    'doctor_permissions','system_settings','system_events','error_logs'
  ]
  loop
    execute format('drop trigger if exists trg_%s_updated_at on public.%I', t, t);
    execute format(
      'create trigger trg_%s_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      t, t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Migração de dados legados (se existirem)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'atendimentos') then
    insert into public.appointments (
      id, patient_id, patient_name, patient_phone, patient_cpf, patient_email,
      condition, medication_in_use, source, status, payment_status, risk_level,
      eligibility, clinical_data, decision_reason, doctor_id, created_at, updated_at
    )
    select
      id, patient_id, paciente_nome, paciente_telefone, paciente_cpf, paciente_email,
      condicao, medicacao_em_uso, origem, status, pagamento_status, risco,
      elegibilidade, dados_clinicos, motivo_decisao, medico_id::text,
      coalesce(criado_em, now()), coalesce(atualizado_em, now())
    from public.atendimentos
    on conflict (id) do nothing;

    update public.patients p
    set
      full_name = coalesce(nullif(p.full_name, ''), (select paciente_nome from public.atendimentos a where a.patient_id = p.id limit 1), ''),
      phone = coalesce(nullif(p.phone, ''), (select paciente_telefone from public.atendimentos a where a.patient_id = p.id limit 1), '')
    where exists (select 1 from information_schema.columns where table_name = 'atendimentos' and column_name = 'paciente_nome');
  end if;
end $$;

-- Backfill patients legados (colunas nome/telefone → full_name/phone)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'patients' and column_name = 'nome') then
    update public.patients
    set
      full_name = coalesce(nullif(full_name, ''), nome, ''),
      phone = coalesce(nullif(phone, ''), telefone, ''),
      birth_date = coalesce(nullif(birth_date, ''), data_nascimento, '')
    where full_name = '' or phone = '';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Storage buckets oficiais
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('receitas', 'receitas', false),
  ('uploads', 'uploads', false),
  ('prontuarios', 'prontuarios', false),
  ('anexos', 'anexos', false),
  ('receitas-antigas', 'receitas-antigas', false),
  ('documentos-clinicos', 'documentos-clinicos', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS — backend usa service_role; anon/authenticated bloqueados por padrão
-- ---------------------------------------------------------------------------
alter table public.patients enable row level security;
alter table public.appointments enable row level security;
alter table public.prescriptions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.medical_records enable row level security;
alter table public.support_tickets enable row level security;
alter table public.payments enable row level security;
alter table public.n8n_events enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'patients','patient_addresses','patient_documents','medical_protocols',
    'triage_sessions','triage_answers','appointments','medical_eligibility',
    'appointment_status_history','support_tickets','support_messages',
    'payments','payment_events','prescriptions','prescription_items',
    'prescription_delivery','medical_records','medical_record_versions',
    'medical_decisions','medical_logs','audit_logs','integration_logs',
    'whatsapp_sessions','whatsapp_messages','n8n_events','typebot_sessions',
    'uploaded_files','uploaded_prescriptions','doctor_profiles','doctor_sessions',
    'doctor_permissions','system_settings','system_events','error_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists "service_role_all_%s" on public.%I', tbl, tbl);
    execute format(
      'create policy "service_role_all_%s" on public.%I for all to service_role using (true) with check (true)',
      tbl, tbl
    );
  end loop;
end $$;

-- Remover tabelas legadas após migração (descomente após validar dados)
-- drop table if exists public.atendimentos cascade;
-- drop table if exists public.decisoes_log cascade;
-- drop table if exists public.entregas_receita cascade;
-- drop table if exists public.webhook_events cascade;
-- drop table if exists public.receitas_memed cascade;
