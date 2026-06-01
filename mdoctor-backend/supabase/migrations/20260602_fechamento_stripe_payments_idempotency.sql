-- Fechamento fase Supabase: pagamentos Stripe idempotentes + webhook_events → appointments

create unique index if not exists idx_payment_events_provider_event_id
  on public.payment_events(provider_event_id)
  where provider_event_id is not null and provider_event_id <> '';

-- Alinhar webhook_events legado (se existir) para appointment_id
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'webhook_events'
  ) then
    alter table public.webhook_events add column if not exists appointment_id uuid;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'webhook_events' and column_name = 'atendimento_id'
    ) then
      update public.webhook_events
      set appointment_id = atendimento_id
      where appointment_id is null and atendimento_id is not null;
    end if;
  end if;
end $$;

-- n8n_events: índice para idempotência Stripe (event_type + payload)
create index if not exists idx_n8n_events_source_type
  on public.n8n_events(source, event_type);
