-- Doctor Prescreve - Upgrade de schema Supabase existente
-- Execute no SQL Editor do Supabase antes do deploy final.

-- Atendimentos: adiciona colunas canonicas sem remover colunas legadas.
alter table public.atendimentos add column if not exists origem text default 'panel';
alter table public.atendimentos add column if not exists pagamento_status text default 'PENDENTE';
alter table public.atendimentos add column if not exists elegibilidade jsonb;
alter table public.atendimentos add column if not exists motivo_decisao text;
alter table public.atendimentos add column if not exists medico_id text;
alter table public.atendimentos add column if not exists atualizado_em timestamptz;
alter table public.atendimentos add column if not exists condicao text;

update public.atendimentos
set atualizado_em = coalesce(atualizado_em, updated_at, criado_em, now())
where atualizado_em is null;

update public.atendimentos
set condicao = coalesce(condicao, doenca_cronica, medicacao_em_uso)
where condicao is null;

update public.atendimentos
set pagamento_status = case
  when pagamento is true then 'CONFIRMADO'
  when pagamento is false then 'PENDENTE'
  else coalesce(pagamento_status, 'PENDENTE')
end
where pagamento_status is null or pagamento_status = 'PENDENTE';

update public.atendimentos
set status = case status
  when 'TRIAGEM' then 'TRIAGED'
  when 'FILA' then 'QUEUE'
  when 'EM_ATENDIMENTO' then 'UNDER_REVIEW'
  when 'PRONTO_PARA_DECISAO' then 'UNDER_REVIEW'
  when 'APROVADO' then 'VALIDATED'
  when 'RECEITA_EMITIDA' then 'VALIDATED'
  when 'RECUSADO' then 'REJECTED'
  when 'CANCELADO' then 'REJECTED'
  else status
end;

alter table public.atendimentos alter column atualizado_em set default now();
alter table public.atendimentos alter column status set default 'TRIAGED';
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

-- Decisoes: adiciona colunas de auditoria canonicas e preserva dados antigos.
alter table public.decisoes_log add column if not exists status_anterior text;
alter table public.decisoes_log add column if not exists status_novo text;
alter table public.decisoes_log add column if not exists motivo text;
alter table public.decisoes_log add column if not exists medico_id text;
alter table public.decisoes_log add column if not exists snapshot jsonb default '{}'::jsonb;
alter table public.decisoes_log add column if not exists criado_em timestamptz;

update public.decisoes_log
set status_novo = coalesce(status_novo, decisao, 'DECISAO')
where status_novo is null;

update public.decisoes_log
set motivo = coalesce(motivo, observacao)
where motivo is null;

update public.decisoes_log
set medico_id = coalesce(medico_id, medico)
where medico_id is null;

update public.decisoes_log
set criado_em = coalesce(criado_em, created_at, now())
where criado_em is null;

alter table public.decisoes_log alter column status_novo set not null;
alter table public.decisoes_log alter column criado_em set default now();
create index if not exists decisoes_log_atendimento_idx on public.decisoes_log(atendimento_id, criado_em desc);
create index if not exists decisoes_log_medico_idx on public.decisoes_log(medico_id);

-- Medicos: adiciona RBAC simples sem quebrar colunas antigas.
alter table public.medicos add column if not exists role text not null default 'doctor';
alter table public.medicos add column if not exists criado_em timestamptz;
alter table public.medicos add column if not exists atualizado_em timestamptz;

update public.medicos
set criado_em = coalesce(criado_em, created_at, now())
where criado_em is null;

update public.medicos
set atualizado_em = coalesce(atualizado_em, updated_at, now())
where atualizado_em is null;

alter table public.medicos alter column criado_em set default now();
alter table public.medicos alter column atualizado_em set default now();
alter table public.medicos drop constraint if exists medicos_role_check;
alter table public.medicos add constraint medicos_role_check check (role in ('doctor', 'admin'));

-- Receitas Memed: persistencia auditavel da receita.
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

-- RLS e grants: backend usa service role; clientes publicos nao acessam direto.
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
on public.atendimentos for all to service_role using (true) with check (true);

drop policy if exists "service_role_full_decisoes_log" on public.decisoes_log;
create policy "service_role_full_decisoes_log"
on public.decisoes_log for all to service_role using (true) with check (true);

drop policy if exists "service_role_full_medicos" on public.medicos;
create policy "service_role_full_medicos"
on public.medicos for all to service_role using (true) with check (true);

drop policy if exists "service_role_full_entregas_receita" on public.entregas_receita;
create policy "service_role_full_entregas_receita"
on public.entregas_receita for all to service_role using (true) with check (true);

drop policy if exists "service_role_full_receitas_memed" on public.receitas_memed;
create policy "service_role_full_receitas_memed"
on public.receitas_memed for all to service_role using (true) with check (true);

-- Receitas legadas: se existir, proteger tabela exposta ao PostgREST.
do $$
begin
  if to_regclass('public.receitas') is not null then
    alter table public.receitas enable row level security;
    alter table public.receitas force row level security;

    revoke all on table public.receitas from anon, authenticated;
    grant all on table public.receitas to service_role;

    drop policy if exists "service_role_full_access_receitas" on public.receitas;
    create policy "service_role_full_access_receitas"
    on public.receitas
    for all
    to service_role
    using (true)
    with check (true);
  end if;
end
$$;
