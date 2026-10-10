-- Compatibilidade staging: código legado ainda grava receitas_memed até deploy completo.
create table if not exists public.receitas_memed (
  id uuid primary key default gen_random_uuid(),
  atendimento_id uuid,
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
  atualizado_em timestamptz not null default now()
);

create index if not exists receitas_memed_atendimento_idx on public.receitas_memed(atendimento_id, criado_em desc);
create index if not exists receitas_memed_receita_id_idx on public.receitas_memed(receita_id);

alter table public.receitas_memed enable row level security;
revoke all on public.receitas_memed from anon, authenticated;
grant all on public.receitas_memed to service_role;

drop policy if exists "service_role_full_receitas_memed" on public.receitas_memed;
create policy "service_role_full_receitas_memed"
  on public.receitas_memed for all to service_role using (true) with check (true);
