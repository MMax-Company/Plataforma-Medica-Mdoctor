import type { AtendimentoForMemed } from './buildPatientFromAtendimento';
import type { MemedPrescriptionItem } from './clinicalPrescription.types';
import { sendAddItemWithDiagnostic } from './memedCommandDiagnostic';
import { apiClient } from '@/services/api';

export type AddMedicationsResult = {
  added: number;
  memed_items_sent: MemedPrescriptionItem[];
  pending_medical_review: boolean;
  pending_reasons: string[];
};

type BackendMemedAddItem = {
  nome: string;
  posologia: string;
  quantidade: number;
  unidade: string;
  frequencia: string;
  duracao_dias: number;
};

type BackendMemedPayloadResponse = {
  success: boolean;
  payload?: {
    addItems: BackendMemedAddItem[];
  };
  error?: string;
  code?: string;
};

/**
 * Adiciona itens (addItem) a partir do payload oficial do backend (/api/memed/payload).
 * Bloqueia payload vazio, divergente ou com unidade diferente de comprimidos.
 */
export async function addMedicationsFromAtendimento(
  atendimento: AtendimentoForMemed,
): Promise<AddMedicationsResult> {
  if (!window.MdHub?.command?.send) {
    return { added: 0, memed_items_sent: [], pending_medical_review: false, pending_reasons: [] };
  }

  let memed_items: MemedPrescriptionItem[] = [];
  const pending_reasons: string[] = [];

  try {
    const data = await apiClient.get<BackendMemedPayloadResponse>(`/api/memed/payload/${atendimento.id}`);
    const items = data.payload?.addItems || [];
    if (!data.success || !items.length) {
      return {
        added: 0,
        memed_items_sent: [],
        pending_medical_review: true,
        pending_reasons: [data.error || 'Payload Memed vazio ou indisponível'],
      };
    }

    for (const item of items) {
      if (!item.nome || !item.posologia || !item.frequencia) {
        pending_reasons.push('Item Memed incompleto (nome, posologia ou frequência ausente)');
        continue;
      }
      if (item.unidade !== 'comprimidos') {
        pending_reasons.push(`Unidade inválida: ${item.unidade || 'desconhecida'}`);
        continue;
      }
      if (!Number.isFinite(item.quantidade) || item.quantidade < 1 || item.duracao_dias !== 60) {
        pending_reasons.push(`Quantidade/duração divergente (${item.quantidade}/${item.duracao_dias})`);
        continue;
      }
      memed_items.push({
        nome: item.nome,
        posologia: item.posologia,
        quantidade: item.quantidade,
      });
    }
  } catch (error) {
    return {
      added: 0,
      memed_items_sent: [],
      pending_medical_review: true,
      pending_reasons: [error instanceof Error ? error.message : 'Falha ao carregar payload Memed'],
    };
  }

  if (!memed_items.length) {
    return {
      added: 0,
      memed_items_sent: [],
      pending_medical_review: true,
      pending_reasons: pending_reasons.length ? pending_reasons : ['Nenhum item Memed válido'],
    };
  }

  let added = 0;
  const memed_items_sent: MemedPrescriptionItem[] = [];

  for (const item of memed_items) {
    const payload: MemedPrescriptionItem = {
      nome: item.nome,
      posologia: item.posologia,
    };
    if (typeof item.quantidade === 'number' && item.quantidade > 0) {
      payload.quantidade = item.quantidade;
    }

    try {
      await sendAddItemWithDiagnostic(payload as Record<string, unknown>);
      added += 1;
      memed_items_sent.push(payload);
    } catch {
      pending_reasons.push(`Falha ao adicionar item: ${item.nome}`);
    }
  }

  return {
    added,
    memed_items_sent,
    pending_medical_review: pending_reasons.length > 0,
    pending_reasons,
  };
}
