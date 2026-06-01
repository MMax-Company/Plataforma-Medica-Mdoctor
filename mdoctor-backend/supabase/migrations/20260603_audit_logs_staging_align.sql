-- Alinha public.audit_logs com audit.store.js (staging / oficial usihurogvphtjedyhyfl).
-- MVP legado (20260527) não tinha origin nem ip_address; inserts falham no PostgREST.

alter table public.audit_logs
  add column if not exists origin text not null default 'api';

alter table public.audit_logs
  add column if not exists ip_address text;

alter table public.audit_logs
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

comment on column public.audit_logs.origin is 'Origem do evento (api, n8n, etc.) — audit.store.js';
comment on column public.audit_logs.ip_address is 'IP do cliente quando disponível — audit.store.js';

-- correlation_id, request_id, user_agent, metadata, event_type, source: apenas em payload jsonb.

notify pgrst, 'reload schema';
