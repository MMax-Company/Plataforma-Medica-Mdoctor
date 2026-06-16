import { hidePrescription, showPrescription } from './showPrescription';

// Garante que o pre-warm rode no máximo uma vez por sessão de browser.
let prewarmScheduled = false;

/**
 * Aquece o SDK Memed em background: chama show() para forçar o carregamento dos
 * sub-módulos internos (platform.digital-signature, synapse.alert, plataforma.medicamento,
 * etc.) e depois chama hide() para ocultar o widget.
 *
 * Resultado: na próxima vez que show() for chamado (primeira prescrição do médico),
 * os sub-módulos já estão no DOM. O core:moduleInit de plataforma.prescricao dispara
 * apenas após o SDK estar estável, e newPrescription completa em < 200ms.
 *
 * NÃO chama newPrescription, setPaciente, addItem nem qualquer MdHub.command.send.
 * NÃO altera Supabase, fluxo clínico ou estado de atendimentos.
 */
export async function prewarmMemedSubmodules(): Promise<void> {
  if (prewarmScheduled) return;
  prewarmScheduled = true;

  try {
    showPrescription();
    // Diagnóstico confirmou que o último sub-módulo carrega em ~14-15s após show().
    // Aguardamos 20s para garantir que todos estejam no DOM antes de ocultar.
    await new Promise<void>((resolve) => setTimeout(resolve, 20_000));
    hidePrescription();
  } catch {
    // Pre-warm é best-effort — falha silenciosa não bloqueia a prescrição.
    prewarmScheduled = false; // Permite nova tentativa se show() ou hide() lançar.
    try {
      hidePrescription();
    } catch {
      // ignorar
    }
  }
}
