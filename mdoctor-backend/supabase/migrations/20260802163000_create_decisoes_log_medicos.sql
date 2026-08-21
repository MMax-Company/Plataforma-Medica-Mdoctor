-- Completa o schema legado exigido pelo production-readiness-check.
-- Migração aditiva e idempotente: não altera nem remove dados existentes.

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

create index if not exists decisoes_log_atendimento_idx
  on public.decisoes_log(atendimento_id, criado_em desc);
create index if not exists decisoes_log_medico_idx
  on public.decisoes_log(medico_id);

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

alter table public.decisoes_log enable row level security;
alter table public.medicos enable row level security;

revoke all on public.decisoes_log from anon, authenticated;
revoke all on public.medicos from anon, authenticated;
grant all on public.decisoes_log to service_role;
grant all on public.medicos to service_role;

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
