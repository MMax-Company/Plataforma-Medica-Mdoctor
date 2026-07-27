-- Uma aprovação médica gera no máximo uma mensagem pendente ao paciente.
-- Espelha uq_whatsapp_messages_clinical_rejection para o novo message_kind
-- 'clinical_approval' (Fase 3 Pedido 1).
create unique index if not exists uq_whatsapp_messages_clinical_approval
  on public.whatsapp_messages (appointment_id)
  where direction = 'outbound'
    and metadata ->> 'message_kind' = 'clinical_approval';
