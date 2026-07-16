alter table public.whatsapp_sessions
  add column if not exists typebot_session_id text;

create unique index if not exists idx_whatsapp_sessions_typebot_session_id
  on public.whatsapp_sessions (typebot_session_id)
  where typebot_session_id is not null;

create table if not exists public.whatsapp_meta_message_receipts (
  meta_message_id text primary key,
  whatsapp_session_id uuid references public.whatsapp_sessions(id) on delete set null,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed')),
  provider_message_ids jsonb not null default '[]'::jsonb,
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.whatsapp_sessions enable row level security;
alter table public.whatsapp_meta_message_receipts enable row level security;

revoke all on table public.whatsapp_meta_message_receipts from anon, authenticated;
grant select, insert, update on table public.whatsapp_meta_message_receipts to service_role;

create index if not exists idx_whatsapp_meta_message_receipts_session
  on public.whatsapp_meta_message_receipts (whatsapp_session_id, created_at desc);

