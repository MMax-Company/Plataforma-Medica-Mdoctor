create table if not exists public.webhook_events (
  idempotency_key text primary key,
  source text not null default 'unknown',
  atendimento_id uuid references public.atendimentos(id) on delete set null,
  decision jsonb,
  reply jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_webhook_events_expires_at on public.webhook_events(expires_at);
create index if not exists idx_webhook_events_atendimento_id on public.webhook_events(atendimento_id);

alter table public.webhook_events enable row level security;

drop policy if exists "backend service role webhook_events" on public.webhook_events;
create policy "backend service role webhook_events"
  on public.webhook_events
  for all
  to service_role
  using (true)
  with check (true);
