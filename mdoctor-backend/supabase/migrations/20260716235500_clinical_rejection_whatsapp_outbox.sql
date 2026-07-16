-- Uma reprovação médica gera no máximo uma mensagem pendente ao paciente.
create unique index if not exists uq_whatsapp_messages_clinical_rejection
  on public.whatsapp_messages (appointment_id)
  where direction = 'outbound'
    and metadata ->> 'message_kind' = 'clinical_rejection';

grant select, insert, update on table public.whatsapp_messages to service_role;
