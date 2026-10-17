-- Fundação do Chat Administrativo de Suporte V1 (ETAPA 1).
-- Migração aditiva: cria apenas as 3 tabelas novas abaixo. Não altera,
-- reutiliza nem remove support_tickets, support_messages, whatsapp_messages
-- ou qualquer tabela/fluxo clínico existente.

create table if not exists public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  -- Estado da CONVERSA — de quem é a vez de agir. Independente da posse
  -- (locked_by/locked_at/lock_expires_at abaixo), por desenho: um atendente
  -- pode estar com o lock enquanto o estado já é 'awaiting_patient' porque
  -- ele acabou de responder. 'claimed' NÃO é um valor deste campo.
  status text not null default 'open'
    check (status in ('open', 'awaiting_agent', 'awaiting_patient', 'closed')),
  locked_by text,
  locked_at timestamptz,
  lock_expires_at timestamptz,
  closed_at timestamptz,
  closed_by text,
  -- Denormalizado a partir de support_chat_messages (atualizado em
  -- recordMessage) só para permitir ordenar a fila por atividade recente sem
  -- full scan/join contra a tabela de mensagens. Mistura inbound+outbound —
  -- para a janela de mensagem livre da Meta (24h), usar last_inbound_at.
  last_message_at timestamptz,
  -- Timestamp da última mensagem do PACIENTE (inbound) — base real da janela
  -- de 24h de mensagem livre da Meta. last_message_at não serve para isso
  -- porque também avança com mensagens do atendente (outbound).
  last_inbound_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Fila do Painel Administrativo: status isolado (ex.: contagem de abertos) e
-- status+atividade combinados (ordenação da fila sem full scan).
create index if not exists support_conversations_status_idx
  on public.support_conversations(status);
create index if not exists support_conversations_status_last_message_idx
  on public.support_conversations(status, last_message_at desc);

-- Varredura de locks expirados (reclaim), independente do status da
-- conversa — uma conversa 'awaiting_agent' ou 'awaiting_patient' pode ter
-- lock ativo e precisa ser encontrada quando esse lock expira.
create index if not exists support_conversations_lock_expires_idx
  on public.support_conversations(lock_expires_at)
  where locked_by is not null;
-- "Meus tickets": maioria das linhas tem locked_by null, não vale indexar
-- sem o filtro parcial.
create index if not exists support_conversations_locked_by_idx
  on public.support_conversations(locked_by)
  where locked_by is not null;

create table if not exists public.support_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  sender text,
  body text not null default '',
  provider_message_id text,
  -- Gerado pelo frontend (ETAPA 4, envio humano) para proteger contra duplo
  -- clique/retry HTTP/reenvio da mesma solicitação — independente do
  -- provider_message_id, que só existe depois que a Meta confirma o envio.
  client_message_id text,
  -- Reservado para fase futura (anexos/mídia) — V1 é só texto, por decisão
  -- explícita do usuário (10/10/2026). Nenhum código desta etapa grava ou lê
  -- este campo; existe só para não exigir outra migration quando mídia for
  -- implementada.
  media jsonb,
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

-- Idempotência de envio humano (frontend): mesma solicitação de envio
-- (duplo clique, retry HTTP) nunca cria uma segunda linha, mesmo antes de
-- existir provider_message_id.
create unique index if not exists support_chat_messages_client_idempotency_idx
  on public.support_chat_messages(conversation_id, client_message_id)
  where client_message_id is not null;

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
