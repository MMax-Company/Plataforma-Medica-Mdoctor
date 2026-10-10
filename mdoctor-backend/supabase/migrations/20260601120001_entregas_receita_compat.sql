-- Compatibilidade: entrega legada até 100% em prescription_delivery.
create table if not exists public.entregas_receita (
  id uuid primary key default gen_random_uuid(),
  atendimento_id uuid,
  canal text,
  provider text,
  provider_message_id text,
  status text not null default 'sent',
  target_masked text,
  erro text,
  snapshot jsonb default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

create index if not exists entregas_receita_atendimento_idx on public.entregas_receita(atendimento_id, criado_em desc);

alter table public.entregas_receita enable row level security;
revoke all on public.entregas_receita from anon, authenticated;
grant all on public.entregas_receita to service_role;

drop policy if exists "service_role_full_entregas_receita" on public.entregas_receita;
create policy "service_role_full_entregas_receita"
  on public.entregas_receita for all to service_role using (true) with check (true);
