import { PRESCRIPTION_MODULE } from './onLoadPrescription';
import type { AtendimentoForMemed } from './buildPatientFromAtendimento';

/** Orientações clínicas no módulo antes de abrir a prescrição. */
export async function setClinicalOrientations(atendimento: AtendimentoForMemed): Promise<void> {
  if (!window.MdHub?.command?.send) return;

  const clinical = (atendimento.dados_clinicos || {}) as Record<string, unknown>;
  const text = String(clinical.conduta || clinical.orientacoes || clinical.orientacao || '').trim();
  if (!text) return;

  try {
    await window.MdHub.command.send(PRESCRIPTION_MODULE, 'setAdditionalData', {
      orientacao: text,
      orientacoes: text,
    });
  } catch {
    // comando opcional por versão do widget
  }
}
