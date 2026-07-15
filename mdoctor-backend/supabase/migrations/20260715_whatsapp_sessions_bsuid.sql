-- Suporte a BSUID: contatos Meta WhatsApp sem número de telefone exposto
-- (mensagens de interoperabilidade chegam com um identificador opaco em vez de wa_id/phone)
alter table public.whatsapp_sessions
  alter column phone drop not null;

alter table public.whatsapp_sessions
  add column if not exists bsuid text,
  add column if not exists parent_bsuid text,
  add column if not exists username text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'whatsapp_sessions_identifier_present'
  ) then
    alter table public.whatsapp_sessions
      add constraint whatsapp_sessions_identifier_present check (phone is not null or bsuid is not null);
  end if;
end $$;

create index if not exists idx_whatsapp_sessions_bsuid on public.whatsapp_sessions (bsuid);
