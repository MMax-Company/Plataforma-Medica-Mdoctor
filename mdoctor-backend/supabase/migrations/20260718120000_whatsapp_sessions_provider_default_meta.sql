-- Evolution API foi removida; Meta WhatsApp Cloud API é o único provider real.
-- Novas linhas de whatsapp_sessions já gravam provider = 'meta' explicitamente
-- (ver whatsapp-sessions.store.js); este ajuste só corrige o default da coluna
-- para refletir o estado atual da integração.
alter table public.whatsapp_sessions
  alter column provider set default 'meta';
