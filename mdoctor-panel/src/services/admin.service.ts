import { apiClient } from './api';
import { authHeaders } from './auth.service';

export type AdminNote = {
  id: string;
  texto: string;
  autor: string;
  criado_em: string;
  resolvido: boolean;
  resolvido_em?: string;
};

export type AdminAtendimento = {
  id: string;
  paciente_nome: string;
  paciente_telefone?: string;
  paciente_cpf?: string;
  paciente_email?: string;
  condicao?: string;
  status: string;
  pagamento_status?: string;
  risco?: string;
  criado_em?: string;
  atualizado_em?: string;
  medico_id?: string | null;
  elegibilidade?: { eligible?: boolean; reason?: string } | null;
  dados_clinicos?: {
    previous_prescription?: boolean;
    foto_receita_url?: string;
    observacoes_admin?: AdminNote[];
    stripe_checkout_url?: string;
    memed_receita?: { pdfUrl?: string; receitaUrl?: string; receitaId?: string };
    entrega_receita?: { channel?: string; status?: string; sent_at?: string };
  };
};

export type AdminDashboard = {
  cards: {
    aguardando_pagamento: number;
    aguardando_receita_anterior: number;
    pronto_para_avaliacao: number;
    em_atendimento: number;
    receitas_prontas: number;
    pendencias_admin: number;
  };
  total: number;
  recentes: AdminAtendimento[];
};

export async function fetchAdminDashboard(): Promise<AdminDashboard> {
  return apiClient.get<AdminDashboard>('/api/admin/dashboard', { headers: authHeaders() });
}

export async function fetchAdminAtendimentos(opts?: {
  status?: string;
  search?: string;
}): Promise<{ success: boolean; atendimentos: AdminAtendimento[]; total: number }> {
  const params = new URLSearchParams();
  if (opts?.status) params.set('status', opts.status);
  if (opts?.search) params.set('search', opts.search);
  const qs = params.toString();
  return apiClient.get(`/api/admin/atendimentos${qs ? `?${qs}` : ''}`, {
    headers: authHeaders(),
  });
}

export async function fetchAdminAtendimento(
  id: string,
): Promise<{ success: boolean; atendimento: AdminAtendimento }> {
  return apiClient.get(`/api/admin/atendimentos/${id}`, { headers: authHeaders() });
}

export async function addAdminNote(
  id: string,
  texto: string,
): Promise<{ success: boolean; nota: AdminNote }> {
  return apiClient.post(`/api/admin/atendimentos/${id}/notes`, { texto }, { headers: authHeaders() });
}

export async function resolveAdminNote(
  atendimentoId: string,
  noteId: string,
): Promise<{ success: boolean }> {
  return apiClient.patch(
    `/api/admin/atendimentos/${atendimentoId}/notes/${noteId}/resolve`,
    {},
    { headers: authHeaders() },
  );
}

export async function resendTypebotLink(
  id: string,
): Promise<{ success: boolean; link: string; sent: boolean; phone: string | null }> {
  return apiClient.post(
    `/api/admin/atendimentos/${id}/resend-typebot`,
    {},
    { headers: authHeaders() },
  );
}

export async function resendPaymentLink(id: string): Promise<{
  success: boolean;
  link: string | null;
  sent: boolean;
  phone: string | null;
  pagamento_status: string;
}> {
  return apiClient.post(
    `/api/admin/atendimentos/${id}/resend-payment`,
    {},
    { headers: authHeaders() },
  );
}
