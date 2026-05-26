create table if not exists public.atendimentos (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'TRIAGED',
  paciente_nome text not null,
  paciente_telefone text,
  paciente_cpf text,
  paciente_email text,
  condicao text,
  origem text default 'panel',
  pagamento_status text default 'PENDENTE',
  risco text,
  elegibilidade jsonb,
  dados_clinicos jsonb default '{}'::jsonb,
  motivo_decisao text,
  medico_id text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint atendimentos_status_check check (
    status in (
      'TRIAGEM',
      'TRIAGED',
      'AGUARDANDO_PAGAMENTO',
      'FILA',
      'QUEUE',
      'EM_ATENDIMENTO',
      'UNDER_REVIEW',
      'MEMED_PROCESSING',
      'AWAITING_VALIDATION',
      'PRONTO_PARA_DECISAO',
      'APROVADO',
      'VALIDATED',
      'REJECTED',
      'RECUSADO',
      'RECEITA_EMITIDA',
      'DELIVERED',
      'FINISHED',
      'CANCELADO'
    )
  )
);

alter table public.atendimentos drop constraint if exists atendimentos_status_check;
alter table public.atendimentos add constraint atendimentos_status_check check (
  status in (
    'TRIAGEM',
    'TRIAGED',
    'AGUARDANDO_PAGAMENTO',
    'FILA',
    'QUEUE',
    'EM_ATENDIMENTO',
    'UNDER_REVIEW',
    'MEMED_PROCESSING',
    'AWAITING_VALIDATION',
    'PRONTO_PARA_DECISAO',
    'APROVADO',
    'VALIDATED',
    'REJECTED',
    'RECUSADO',
    'RECEITA_EMITIDA',
    'DELIVERED',
    'FINISHED',
    'CANCELADO'
  )
);

create index if not exists atendimentos_status_idx on public.atendimentos(status);
create index if not exists atendimentos_criado_em_idx on public.atendimentos(criado_em desc);
create index if not exists atendimentos_medico_id_idx on public.atendimentos(medico_id);
create index if not exists atendimentos_dados_clinicos_gin_idx on public.atendimentos using gin(dados_clinicos);

alter table public.atendimentos add column if not exists paciente_cpf text;
alter table public.atendimentos add column if not exists paciente_email text;
alter table public.atendimentos add column if not exists origem text default 'panel';
alter table public.atendimentos add column if not exists pagamento_status text default 'PENDENTE';
alter table public.atendimentos add column if not exists elegibilidade jsonb;
alter table public.atendimentos add column if not exists motivo_decisao text;
alter table public.atendimentos add column if not exists medico_id text;
alter table public.atendimentos add column if not exists atualizado_em timestamptz not null default now();

create table if not exists public.decisoes_log (
  id uuid primary key default gen_random_uuid(),
  atendimento_id uuid references public.atendimentos(id) on delete cascade,
  status_anterior text,
  status_novo text not null,
  motivo text,
  medico_id text,
  snapshot jsonb default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

create index if not exists decisoes_log_atendimento_idx on public.decisoes_log(atendimento_id, criado_em desc);
create index if not exists decisoes_log_medico_idx on public.decisoes_log(medico_id);

create table if not exists public.medicos (
  id text primary key,
  nome text not null,
  crm text,
  crm_uf text,
  email text,
  role text not null default 'doctor',
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint medicos_role_check check (role in ('doctor', 'admin'))
);

create table if not exists public.entregas_receita (
  id text primary key,
  atendimento_id uuid references public.atendimentos(id) on delete cascade,
  canal text not null,
  provider text,
  provider_message_id text,
  status text not null,
  target_masked text,
  erro text,
  snapshot jsonb default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  constraint entregas_receita_canal_check check (canal in ('whatsapp', 'email', 'sms')),
  constraint entregas_receita_status_check check (status in ('sent', 'failed', 'delivered', 'queued'))
);

create index if not exists entregas_receita_atendimento_idx on public.entregas_receita(atendimento_id, criado_em desc);
create index if not exists entregas_receita_status_idx on public.entregas_receita(status);

create table if not exists public.receitas_memed (
  id uuid primary key default gen_random_uuid(),
  atendimento_id uuid references public.atendimentos(id) on delete cascade,
  receita_id text,
  protocolo text,
  receita_url text,
  pdf_url text,
  storage_path text,
  status text not null default 'AWAITING_VALIDATION',
  provider text not null default 'Memed',
  payload jsonb default '{}'::jsonb,
  medico_id text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint receitas_memed_status_check check (
    status in ('MEMED_PROCESSING', 'AWAITING_VALIDATION', 'VALIDATED', 'DELIVERED', 'REJECTED', 'FAILED')
  )
);

create index if not exists receitas_memed_atendimento_idx on public.receitas_memed(atendimento_id, criado_em desc);
create index if not exists receitas_memed_receita_id_idx on public.receitas_memed(receita_id);
create index if not exists receitas_memed_status_idx on public.receitas_memed(status);

alter table public.atendimentos enable row level security;
alter table public.decisoes_log enable row level security;
alter table public.medicos enable row level security;
alter table public.entregas_receita enable row level security;
alter table public.receitas_memed enable row level security;

revoke all on public.atendimentos from anon, authenticated;
revoke all on public.decisoes_log from anon, authenticated;
revoke all on public.medicos from anon, authenticated;
revoke all on public.entregas_receita from anon, authenticated;
revoke all on public.receitas_memed from anon, authenticated;

grant all on public.atendimentos to service_role;
grant all on public.decisoes_log to service_role;
grant all on public.medicos to service_role;
grant all on public.entregas_receita to service_role;
grant all on public.receitas_memed to service_role;

drop policy if exists "service_role_full_atendimentos" on public.atendimentos;
create policy "service_role_full_atendimentos"
on public.atendimentos
for all
to service_role
using (true)
with check (true);

drop policy if exists "service_role_full_decisoes_log" on public.decisoes_log;
create policy "service_role_full_decisoes_log"
on public.decisoes_log
for all
to service_role
using (true)
with check (true);

drop policy if exists "service_role_full_medicos" on public.medicos;
create policy "service_role_full_medicos"
on public.medicos
for all
to service_role
using (true)
with check (true);

drop policy if exists "service_role_full_entregas_receita" on public.entregas_receita;
create policy "service_role_full_entregas_receita"
on public.entregas_receita
for all
to service_role
using (true)
with check (true);

drop policy if exists "service_role_full_receitas_memed" on public.receitas_memed;
create policy "service_role_full_receitas_memed"
on public.receitas_memed
for all
to service_role
using (true)
with check (true);
