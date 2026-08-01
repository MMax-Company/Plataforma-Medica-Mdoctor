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
  numero_curto?: number | null;
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
  elegibilidade?: { eligible?: boolean; reason?: string; reasonCode?: string | null } | null;
  dados_clinicos?: {
    previous_prescription?: boolean;
    foto_receita_url?: string;
    observacoes_admin?: AdminNote[];
    stripe_checkout_url?: string;
    memed_receita?: { pdfUrl?: string; receitaUrl?: string; receitaId?: string };
    entrega_receita?: { channel?: string; status?: string; sent_at?: string };
    motivo_rejeicao?: { code?: string; label?: string; detail?: string | null; rejected_at?: string } | null;
    support_sub_status?: string | null;
    queue_type?: string | null;
    medical_support_reason?: string | null;
    medical_support_requested_at?: string | null;
    clinical_audit?: { approvedBy?: string | null; rejectedBy?: string | null } | null;
  };
};

// clinical_audit.approvedBy/rejectedBy grava req.user.sub (identificador
// técnico de login, ex.: "dr_max_vinicius_001") — nunca um nome de exibição.
// Mapeia só para apresentação; o valor histórico gravado não é alterado.
const KNOWN_DOCTOR_DISPLAY_NAMES: Record<string, string> = {
  dr_max_vinicius_001: 'Dr. Max Matos',
  'drmax.matos': 'Dr. Max Matos',
};

// Nome do responsável clínico para exibição — medico_id (coluna) é
// estruturalmente sempre null com o esquema de login atual (username, não
// numérico); usa o fallback real gravado em dados_clinicos.clinical_audit.
export function medicoResponsavel(a: AdminAtendimento): string | null {
  const raw =
    a.medico_id ||
    a.dados_clinicos?.clinical_audit?.approvedBy ||
    a.dados_clinicos?.clinical_audit?.rejectedBy ||
    null;
  if (!raw) return null;
  return KNOWN_DOCTOR_DISPLAY_NAMES[raw.trim().toLowerCase()] || raw;
}

export type AdminDashboard = {
  cards: {
    aguardando_pagamento: number;
    aguardando_receita_anterior: number;
    pronto_para_avaliacao: number;
    em_atendimento: number;
    receitas_prontas: number;
    pendencias_admin: number;
  };
  financeiro: {
    atendimentos_pagos: number;
    valor_unitario_centavos: number;
    valor_unitario_label: string;
    receita_total_centavos: number;
    receita_total_label: string;
  };
  tempos: {
    amostra: number;
    triagem: string | null;
    espera_medica: string | null;
    avaliacao: string | null;
    emissao_receita: string | null;
    jornada_completa: string | null;
    suporte_administrativo: string | null;
    suporte_medico: string | null;
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

export async function forwardToDoctor(
  id: string,
  motivo: string,
): Promise<{ success: boolean; atendimento: AdminAtendimento }> {
  return apiClient.post(
    `/api/admin/atendimentos/${id}/forward-to-doctor`,
    { motivo },
    { headers: authHeaders() },
  );
}
