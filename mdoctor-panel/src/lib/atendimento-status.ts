/**
 * Mapeia status canônicos do backend (lowercase) para colunas do painel médico.
 */
export type PanelAtendimentoStatus =
  | 'QUEUE'
  | 'UNDER_REVIEW'
  | 'MEMED_PROCESSING'
  | 'AWAITING_VALIDATION'
  | 'VALIDATED'
  | 'REJECTED'
  | 'FINISHED'
  | 'DELIVERED'
  | 'TRIAGED'
  | 'FILA'
  | 'EM_ATENDIMENTO'
  | 'PRONTO_PARA_DECISAO'
  | 'APROVADO'
  | 'RECUSADO'
  | 'RECEITA_EMITIDA';

export function toPanelAtendimentoStatus(status?: string | null): PanelAtendimentoStatus | null {
  const s = String(status || 'waiting').trim().toLowerCase();
  if (['waiting', 'queue', 'fila', 'triaged', 'triagem', 'aguardando_pagamento', 'em_atendimento'].includes(s)) return 'QUEUE';
  if (['under_review', 'approved', 'pronto_para_decisao', 'receita_em_edicao'].includes(s)) return 'EM_ATENDIMENTO';
  if (['memed_processing', 'awaiting_reemissao', 'error_memed'].includes(s)) return 'MEMED_PROCESSING';
  if (['receita_emitida', 'awaiting_validation'].includes(s)) return 'RECEITA_EMITIDA';
  if (['ready', 'validated', 'aprovado'].includes(s)) return 'VALIDATED';
  if (['rejected', 'recusado', 'inelegivel', 'cancelado'].includes(s)) return 'REJECTED';
  if (['delivered'].includes(s)) return 'DELIVERED';
  if (['finished', 'finalized'].includes(s)) return 'FINISHED';
  const upper = String(status || '').toUpperCase() as PanelAtendimentoStatus;
  const known: PanelAtendimentoStatus[] = [
    'QUEUE',
    'EM_ATENDIMENTO',
    'MEMED_PROCESSING',
    'RECEITA_EMITIDA',
    'VALIDATED',
    'REJECTED',
  ];
  if (known.includes(upper)) return upper;
  return null;
}

export function hasPersistedMemedReceipt(dados_clinicos?: {
  memed_receita?: { receitaId?: string; pdfUrl?: string; receitaUrl?: string; validated_at?: string };
} | null): boolean {
  const r = dados_clinicos?.memed_receita;
  if (!r) return false;
  return Boolean(r.receitaId || r.pdfUrl || r.receitaUrl);
}
