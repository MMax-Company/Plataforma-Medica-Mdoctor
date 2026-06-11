import { applyClinicalMemedUx } from './applyClinicalUx';
import { addMedicationsFromAtendimento } from './addMedicationsFromAtendimento';
import { setClinicalOrientations } from './setClinicalOrientations';
import type { AtendimentoForMemed } from './buildPatientFromAtendimento';
import { buildPatientFromAtendimento } from './buildPatientFromAtendimento';
import type { MemedPrescriptionItem } from './clinicalPrescription.types';
import {
  captureIframeState,
  clearMemedDiagnosticLog,
  pushDiagnosticEvent,
} from './memedCommandDiagnostic';
import {
  clearLastCycleEmitted,
  isMemedRuntimeReady,
  markPrescriptionShownOnce,
  wasPrescriptionShownBefore,
  waitForModuleReinit,
  wasLastCycleEmitted,
} from './memedRuntime';
import { setMemedPatient } from './setMemedPatient';
import { hidePrescription, showPrescription } from './showPrescription';
import type { MemedPatient } from './types';

export type PreparePrescriptionResult = {
  medCount: number;
  memed_items_sent: MemedPrescriptionItem[];
  pending_medical_review: boolean;
  pending_reasons: string[];
};

// Garante que setFeatureToggle rode UMA VEZ por sessão de browser.
let clinicalUxApplied = false;

async function applyFeatureToggleOnce(): Promise<void> {
  if (clinicalUxApplied) return;
  clinicalUxApplied = true;
  try {
    await applyClinicalMemedUx();
  } catch {
    // UX clínica é best-effort — falha não impede a prescrição.
  }
}

/**
 * Fluxo oficial Memed — todos os comandos de pré-configuração ANTES de show():
 *   setFeatureToggle (1× por sessão) → setPaciente → addItem → setClinicalOrientations → show()
 *
 * Referência: documentação oficial Memed — core:moduleInit dispara quando o módulo
 * está pronto; nesse momento executa-se a pré-configuração do paciente e só então
 * chama-se MdHub.module.show().
 *
 * newPrescription removido: ausente na documentação oficial e causava timeout de 15s
 * enquanto sub-módulos (assinatura digital, catálogo de medicamentos, etc.) carregavam.
 */
export async function prepareAndShowPrescription(
  atendimento: AtendimentoForMemed,
  patient?: MemedPatient | null,
): Promise<PreparePrescriptionResult> {
  clearMemedDiagnosticLog();

  const resolvedPatient = patient || buildPatientFromAtendimento(atendimento);

  pushDiagnosticEvent('prepareStart', {
    patientId: resolvedPatient.idExterno,
    moduleReadyBefore: isMemedRuntimeReady(),
    iframes: captureIframeState(),
  });

  // Para pacientes subsequentes (P2+): dois caminhos dependendo do ciclo anterior.
  if (wasPrescriptionShownBefore()) {
    const emitted = wasLastCycleEmitted();
    clearLastCycleEmitted(); // consome o flag antes de qualquer await

    if (emitted) {
      // Ciclo anterior terminou com emissão real: o iframe mostra "Documento emitido".
      // O SDK reinicializa após hide() nesse caso — aguarda core:moduleInit (máx 12s).
      // Se timeout, prossegue mesmo assim em vez de bloquear indefinidamente.
      pushDiagnosticEvent('reinit:start', { reason: 'post-emission', iframes: captureIframeState() });
      const reinitWait = waitForModuleReinit(12_000);
      hidePrescription();
      try {
        await reinitWait;
        pushDiagnosticEvent('reinit:done', { iframes: captureIframeState() });
      } catch {
        pushDiagnosticEvent('reinit:timeout', { iframes: captureIframeState() });
        // SDK pode ainda aceitar comandos — segue sem bloquear
      }
    } else {
      // Ciclo anterior fechado sem emissão: SDK vivo na memória, sem reinit necessário.
      pushDiagnosticEvent('hide:before-next', { iframes: captureIframeState() });
      hidePrescription();
      await new Promise<void>((r) => setTimeout(r, 200));
      pushDiagnosticEvent('hide:done', { iframes: captureIframeState() });
    }
  }

  // 1. setFeatureToggle — executar antes de setPaciente conforme docs oficiais.
  //    Rodado apenas na primeira prescrição da sessão.
  pushDiagnosticEvent('setFeatureToggle:start', { iframes: captureIframeState() });
  await applyFeatureToggleOnce();
  pushDiagnosticEvent('setFeatureToggle:done', { iframes: captureIframeState() });

  // 2. setPaciente — obrigatório antes de show(); falha aborta o fluxo.
  pushDiagnosticEvent('setPaciente:start', { iframes: captureIframeState() });
  await setMemedPatient(resolvedPatient);
  pushDiagnosticEvent('setPaciente:done', { iframes: captureIframeState() });

  // 3. addItem + orientações clínicas — antes de show(); falha por item não bloqueia abertura.
  pushDiagnosticEvent('addMeds:start', { iframes: captureIframeState() });
  const { added, memed_items_sent, pending_medical_review, pending_reasons } =
    await addMedicationsFromAtendimento(atendimento);
  await setClinicalOrientations(atendimento);
  pushDiagnosticEvent('addMeds:done', { added, iframes: captureIframeState() });

  // 4. show() por último — após todos os comandos de pré-configuração.
  pushDiagnosticEvent('show:start', { iframes: captureIframeState() });
  showPrescription();
  pushDiagnosticEvent('show:done', { iframes: captureIframeState() });

  markPrescriptionShownOnce();

  return {
    medCount: added,
    memed_items_sent,
    pending_medical_review,
    pending_reasons,
  };
}
