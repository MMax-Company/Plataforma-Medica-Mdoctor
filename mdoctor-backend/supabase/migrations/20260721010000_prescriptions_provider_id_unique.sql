-- Fase 3 pedido 2 — vínculo único: um provider_prescription_id (ex.: memedId)
-- nunca pode ficar associado a mais de um atendimento/paciente. Índice
-- parcial (ignora linhas sem provider_prescription_id, ex. rascunhos).
create unique index if not exists uq_prescriptions_provider_prescription_id
  on public.prescriptions (provider, provider_prescription_id)
  where provider_prescription_id is not null;

-- Fila idempotente de entrega da receita pelo WhatsApp (mesmo mecanismo de
-- whatsapp_messages usado para aprovação/reprovação clínica).
create unique index if not exists uq_whatsapp_messages_prescription_delivery
  on public.whatsapp_messages (appointment_id)
  where direction = 'outbound'
    and metadata ->> 'message_kind' = 'prescription_delivery';
