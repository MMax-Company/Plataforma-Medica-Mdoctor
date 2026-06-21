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
  cancelPendingHardReset,
  hardResetMemedContainer,
  isMemedRuntimeReady,
  markPrescriptionShownOnce,
  waitForMemedModuleReady,
  wasPrescriptionShownBefore,
} from './memedRuntime';
import { setMemedPatient } from './setMemedPatient';
import { showPrescription } from './showPrescription';
import { resetEmissionGuard } from './setupPrescriptionCallback';
import type { MemedPatient } from './types';

export type PreparePrescriptionResult = {
  medCount: number;
  memed_items_sent: MemedPrescriptionItem[];
  pending_medical_review: boolean;
  pending_reasons: string[];
};

// Guard para não enviar setFeatureToggle duplo na P1 (resolveModuleReady já enviou).
// P2+ são cobertos pelo callback core:moduleInit em memedRuntime.ts.
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
  // Reseta guard de idempotência: garante que o próximo prescricaoImpressa deste
  // paciente seja processado normalmente (não ignorado como duplicata do anterior).
  resetEmissionGuard();

  const resolvedPatient = patient || buildPatientFromAtendimento(atendimento);

  console.log('[Memed DEBUG] Passo 1: prepareAndShowPrescription iniciado', { patient: resolvedPatient.idExterno, shownBefore: wasPrescriptionShownBefore(), moduleReady: isMemedRuntimeReady() });
  pushDiagnosticEvent('prepareStart', {
    patientId: resolvedPatient.idExterno,
    moduleReadyBefore: isMemedRuntimeReady(),
    iframes: captureIframeState(),
  });

  // P2+: MdHub já está carregado — não espera core:moduleInit (não redispara no segundo paciente).
  // Remove o CSS de force-hide e prossegue diretamente para os comandos SDK.
  if (wasPrescriptionShownBefore()) {
    cancelPendingHardReset();
    hardResetMemedContainer();
    // Fix 3: reaplica feature toggle para cada paciente P2+
    clinicalUxApplied = false;
    // Fix 2: limpa contexto da receita anterior antes de setPaciente
    const mdHubForNew = window.MdHub;
    if (mdHubForNew?.command?.send) {
      try {
        await Promise.race([
          mdHubForNew.command.send('plataforma.prescricao', 'newPrescription'),
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
        ]);
        console.log('[Memed DEBUG] newPrescription OK (P2+)');
      } catch (err) {
        console.warn('[MEMED_PHASE3] newPrescription timeout — aguardando recuperação do SDK', err);
        await waitForMemedModuleReady();
      }
    }
    pushDiagnosticEvent('container:reset', { iframes: captureIframeState() });
    console.log('[Memed DEBUG] Passo 2: container reset feito (P2+), MdHub disponível:', 'MdHub' in window);
  } else {
    console.log('[Memed DEBUG] Passo 2: primeira prescrição (P1)');
  }

  // 1. setFeatureToggle — executar antes de setPaciente conforme docs oficiais.
  //    Rodado apenas na primeira prescrição da sessão.
  console.log('[Memed DEBUG] Passo 3: antes do applyFeatureToggleOnce');
  pushDiagnosticEvent('setFeatureToggle:start', { iframes: captureIframeState() });
  await applyFeatureToggleOnce();
  pushDiagnosticEvent('setFeatureToggle:done', { iframes: captureIframeState() });
  console.log('[Memed DEBUG] Passo 4: applyFeatureToggleOnce concluído');

  // 2. setPaciente — obrigatório antes de show(); falha aborta o fluxo.
  console.log('[Memed DEBUG] Passo 5: antes do setMemedPatient', { idExterno: resolvedPatient.idExterno });
  pushDiagnosticEvent('setPaciente:start', { iframes: captureIframeState() });
  await setMemedPatient(resolvedPatient);
  pushDiagnosticEvent('setPaciente:done', { iframes: captureIframeState() });
  console.log('[Memed DEBUG] Passo 6: setMemedPatient concluído');

  // 3. addItem + orientações clínicas — antes de show(); falha por item não bloqueia abertura.
  console.log('[Memed DEBUG] Passo 7: antes do addMedicationsFromAtendimento');
  pushDiagnosticEvent('addMeds:start', { iframes: captureIframeState() });
  const { added, memed_items_sent, pending_medical_review, pending_reasons } =
    await addMedicationsFromAtendimento(atendimento);
  console.log('[Memed DEBUG] Passo 8: addMedications concluído, antes do setClinicalOrientations');
  await setClinicalOrientations(atendimento);
  pushDiagnosticEvent('addMeds:done', { added, iframes: captureIframeState() });
  console.log('[Memed DEBUG] Passo 9: setClinicalOrientations concluído');

  // 4. show() por último — após todos os comandos de pré-configuração.
  pushDiagnosticEvent('show:start', { iframes: captureIframeState() });
  console.log('[MEMED_PHASE2] waiting_module_ready_before_show');
  try {
    await Promise.race([
      waitForMemedModuleReady(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('moduleReady timeout before show')), 10000),
      ),
    ]);
    console.log('[MEMED_PHASE2] module_ready_before_show');
  } catch (err) {
    console.warn('[MEMED_PHASE2] module_ready_timeout_before_show', err);
  }
  console.log('[Memed] antes do show()');
  showPrescription();
  console.log('[Memed] show() chamado');
  console.log('[MEMED_PHASE2] show_allowed');
  pushDiagnosticEvent('show:done', { iframes: captureIframeState() });

  markPrescriptionShownOnce();

  return {
    medCount: added,
    memed_items_sent,
    pending_medical_review,
    pending_reasons,
  };
}
