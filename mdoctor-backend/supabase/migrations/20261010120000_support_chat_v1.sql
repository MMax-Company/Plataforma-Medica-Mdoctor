-- Fundação do Chat Administrativo de Suporte V1 (ETAPA 1).
-- Migração aditiva: cria apenas as 3 tabelas novas abaixo. Não altera,
-- reutiliza nem remove support_tickets, support_messages, whatsapp_messages
-- ou qualquer tabela/fluxo clínico existente.

create table if not exists public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'claimed', 'closed')),
  locked_by text,
  locked_at timestamptz,
  lock_expires_at timestamptz,
  closed_at timestamptz,
  closed_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists support_conversations_status_idx
  on public.support_conversations(status);
create index if not exists support_conversations_lock_expires_idx
  on public.support_conversations(lock_expires_at);

create table if not exists public.support_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  sender text,
  body text not null default '',
  provider_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists support_chat_messages_conversation_idx
  on public.support_chat_messages(conversation_id, created_at);

-- Idempotência de inbound/outbound: nunca duplicar a mesma mensagem de
-- provider (Meta) para a mesma conversa.
create unique index if not exists support_chat_messages_provider_idempotency_idx
  on public.support_chat_messages(conversation_id, provider_message_id)
  where provider_message_id is not null;

create table if not exists public.support_conversation_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  event_type text not null check (event_type in (
    'conversation_created',
    'claimed',
    'released',
    'lock_expired',
    'message_sent',
    'message_failed',
    'marked_read',
    'closed',
    'force_transferred'
  )),
  actor text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists support_conversation_events_conversation_idx
  on public.support_conversation_events(conversation_id, created_at);

alter table public.support_conversations enable row level security;
alter table public.support_chat_messages enable row level security;
alter table public.support_conversation_events enable row level security;

revoke all on public.support_conversations from anon, authenticated;
revoke all on public.support_chat_messages from anon, authenticated;
revoke all on public.support_conversation_events from anon, authenticated;

grant all on public.support_conversations to service_role;
grant all on public.support_chat_messages to service_role;
grant all on public.support_conversation_events to service_role;

drop policy if exists "service_role_full_support_conversations" on public.support_conversations;
create policy "service_role_full_support_conversations"
  on public.support_conversations
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service_role_full_support_chat_messages" on public.support_chat_messages;
create policy "service_role_full_support_chat_messages"
  on public.support_chat_messages
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service_role_full_support_conversation_events" on public.support_conversation_events;
create policy "service_role_full_support_conversation_events"
  on public.support_conversation_events
  for all
  to service_role
  using (true)
  with check (true);
