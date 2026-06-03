-- Fluxo oficial receita: approved → receita_em_edicao → receita_emitida (lowercase canônicos)
alter table public.atendimentos drop constraint if exists atendimentos_status_check;

alter table public.atendimentos add constraint atendimentos_status_check check (
  status in (
    'waiting',
    'awaiting_prescription_upload',
    'em_atendimento',
    'approved',
    'receita_em_edicao',
    'receita_emitida',
    'memed_processing',
    'ready',
    'delivered',
    'rejected',
    'TRIAGEM',
    'TRIAGED',
    'AGUARDANDO_PAGAMENTO',
    'FILA',
    'QUEUE',
    'EM_ATENDIMENTO',
    'UNDER_REVIEW',
    'MEMED_PROCESSING',
    'AWAITING_VALIDATION',
    'PRONTO_PARA_DECISAO',
    'APROVADO',
    'VALIDATED',
    'REJECTED',
    'RECUSADO',
    'RECEITA_EMITIDA',
    'DELIVERED',
    'FINISHED',
    'CANCELADO'
  )
);
