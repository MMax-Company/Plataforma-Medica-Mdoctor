'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MemedConfig } from '@/services/memed.service';
import {
  buildPatientFromAtendimento,
  destroyMemedContainerChildren,
  ensureMemedScript,
  parsePrescriptionPayload,
  prepareAndShowPrescription,
  resetPrescriptionCallbacksFlag,
  setupPrescriptionCallback,
  softHideMemed,
  isMemedRuntimeReady,
  type AtendimentoForMemed,
  type MemedPatient,
} from '@/lib/memed';

export type UseMemedSinapseOptions = {
  config: MemedConfig | null;
  doctorToken: string;
  atendimento: AtendimentoForMemed | null;
  /** Refresh só ao abrir receita (evita invalidar sessão BirdID). */
  refreshDoctorToken: (options?: { force?: boolean }) => Promise<string>;
  onPrescriptionPrinted: (payload: unknown) => void | Promise<void>;
  onPrescriptionDeleted?: (payload: unknown) => void | Promise<void>;
  autoOpenWhenReady?: boolean;
};

export type UseMemedSinapseResult = {
  loadingModule: boolean;
  readyToOpen: boolean;
  isOpening: boolean;
  /** true após openPrescription() concluir com sucesso pela primeira vez — oculta botão redundante */
  prescriptionOpenedOnce: boolean;
  openPrescription: () => Promise<void>;
  /** Escape valve: limpa iframes residuais e reabre a prescrição para o paciente atual. */
  resetAndReopen: () => Promise<void>;
  statusMessage: string;
};

// 120s cobre pior caso paciente subsequente: setPaciente(42s) + addItem(20s) + show + buffer
const MEMED_OPEN_TIMEOUT_MS = 120_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

/**
 * Manual alinhado ao memed-react (sem MemedProvider): script único global, paciente antes do show.
 */
export function useMemedSinapse(options: UseMemedSinapseOptions): UseMemedSinapseResult {
  const {
    config,
    doctorToken,
    atendimento,
    refreshDoctorToken,
    onPrescriptionPrinted,
    onPrescriptionDeleted,
    autoOpenWhenReady = false,
  } = options;

  const [moduleReady, setModuleReady] = useState(false);
  const [clinicalReady, setClinicalReady] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Preparando prescrição digital…');
  // BOTÃO 2 — "Carregar prescrição": quando true, o botão é OCULTADO no Workspace,
  // impedindo que o médico recarregue/limpe acidentalmente uma prescrição já em edição.
  // Resetado apenas ao trocar de paciente (atendimento.id muda).
  const [prescriptionOpenedOnce, setPrescriptionOpenedOnce] = useState(false);
  const callbackRegistered = useRef(false);
  const autoOpened = useRef(false);
  const openingInFlight = useRef(false);
  // Guard de ciclo: impede dois openPrescription() concorrentes (ex. duplo-clique).
  // Liberado SOMENTE por prescricaoImpressa (BOTÃO 4) ou timeout de 60 s.
  const cycleInProgressRef = useRef(false);
  const cycleLockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const tokenRef = useRef(doctorToken);
  tokenRef.current = doctorToken;

  const onPrintedRef = useRef(onPrescriptionPrinted);
  const onDeletedRef = useRef(onPrescriptionDeleted);
  onPrintedRef.current = onPrescriptionPrinted;
  onDeletedRef.current = onPrescriptionDeleted;

  const scriptConfig = useMemo(
    () =>
      config
        ? {
            scriptUrl: config.scriptUrl,
            scriptId: 'memedScript',
            containerId: config.containerId,
            primaryColor: config.primaryColor || '#1557FF',
          }
        : null,
    [config],
  );

  const patient: MemedPatient | null = useMemo(
    () => (atendimento ? buildPatientFromAtendimento(atendimento) : null),
    [atendimento],
  );

  useEffect(() => {
    if (!doctorToken || !scriptConfig) return;

    let cancelled = false;
    setStatusMessage('Carregando motor de prescrição (sessão única)…');

    ensureMemedScript(doctorToken, scriptConfig)
      .then(() => {
        if (cancelled) return;
        setModuleReady(true);
        setStatusMessage('Pronto para emitir — paciente e medicamentos serão aplicados ao abrir.');
      })
      .catch((error) => {
        if (!cancelled) {
          setStatusMessage(error instanceof Error ? error.message : 'Falha ao carregar prescrição digital');
        }
      });

    return () => {
      cancelled = true;
      softHideMemed();
    };
  }, [doctorToken, scriptConfig?.scriptUrl, scriptConfig?.containerId, scriptConfig?.primaryColor]);

  useEffect(() => {
    if (!moduleReady || !patient || !atendimento) return;

    if (!callbackRegistered.current) {
      resetPrescriptionCallbacksFlag();
      setupPrescriptionCallback({
        onPrescriptionPrinted: (payload) => {
          if (cycleLockTimeoutRef.current !== null) {
            clearTimeout(cycleLockTimeoutRef.current);
            cycleLockTimeoutRef.current = null;
          }
          cycleInProgressRef.current = false;
          console.log('[MEMED_PHASE3] cycle_lock_released');
          onPrintedRef.current(payload);
        },
        onPrescriptionDeleted: onDeletedRef.current ? (p) => onDeletedRef.current?.(p) : undefined,
      });
      callbackRegistered.current = true;
    }

    setClinicalReady(true);
    setStatusMessage('Pronto para emitir. Assinatura digital ativa na sessão do turno.');
  }, [moduleReady, patient, atendimento?.id]);

  /**
   * BOTÃO 2 — "Carregar prescrição"
   *
   * Prepara uma sessão limpa da Memed para o paciente atual:
   *   1. Garante que não há resíduo visual do paciente anterior.
   *   2. Carrega paciente e medicação do atendimento atual.
   *   3. Exibe o widget Memed via show().
   *
   * NÃO emite receita. NÃO assina. NÃO salva. NÃO chama botão nativo da Memed.
   * NÃO deve ser chamado enquanto o médico edita — após concluir, prescriptionOpenedOnce
   * é true e o botão some da UI (ver showEmitButton no Workspace).
   */
  const openPrescription = useCallback(async () => {
    if (!atendimento || !patient || !scriptConfig) {
      setStatusMessage('Atendimento ou configuração de prescrição incompletos.');
      return;
    }

    if (cycleInProgressRef.current) {
      console.log('[MEMED_PHASE3] cycle_already_running');
      return;
    }

    cycleInProgressRef.current = true;
    console.log('[MEMED_PHASE3] cycle_lock_acquired');
    if (cycleLockTimeoutRef.current !== null) clearTimeout(cycleLockTimeoutRef.current);
    cycleLockTimeoutRef.current = setTimeout(() => {
      console.warn('[MEMED_PHASE3] cycle_lock_timeout_release');
      cycleInProgressRef.current = false;
      cycleLockTimeoutRef.current = null;
    }, 60_000);

    if (openingInFlight.current) return;
    openingInFlight.current = true;
    setIsOpening(true);
    try {
      setStatusMessage('Aplicando dados clínicos e abrindo prescrição…');
      console.log('[Memed] openPrescription chamado para:', atendimento?.paciente_nome);
      const emissionTs = Date.now();
      const emissionPatient = buildPatientFromAtendimento(atendimento, emissionTs);
      const result = await withTimeout(
        (async () => {
          if ('MdHub' in window) {
            console.log('[Memed] MdHub existe, reutilizando');
            const r = await prepareAndShowPrescription(atendimento, emissionPatient);
            console.log('[Memed] prepareAndShowPrescription concluído');
            return r;
          }
          console.log('[Memed] MdHub não existe, criando do zero');
          const moduleAlreadyReady = isMemedRuntimeReady();
          const freshToken = await refreshDoctorToken({ force: !moduleAlreadyReady });
          await ensureMemedScript(freshToken, scriptConfig);
          const r = await prepareAndShowPrescription(atendimento, emissionPatient);
          console.log('[Memed] prepareAndShowPrescription concluído');
          return r;
        })(),
        MEMED_OPEN_TIMEOUT_MS,
        'Tempo esgotado ao abrir a prescrição Memed. Verifique token/script/API alinhados e tente novamente.',
      );
      const pendingNote = result.pending_medical_review
        ? ' Alguns dados clínicos exigem revisão médica antes de emitir.'
        : '';
      setPrescriptionOpenedOnce(true);
      setStatusMessage(
        result.medCount > 0
          ? `Prescrição aberta com paciente e ${result.medCount} medicamento(s) pré-preenchido(s). Revise e assine digitalmente.${pendingNote}`
          : `Prescrição aberta com paciente vinculado. Revise medicamentos e assine digitalmente.${pendingNote}`,
      );
    } catch (error) {
      if (cycleLockTimeoutRef.current !== null) {
        clearTimeout(cycleLockTimeoutRef.current);
        cycleLockTimeoutRef.current = null;
      }
      cycleInProgressRef.current = false;
      setStatusMessage(error instanceof Error ? error.message : 'Não foi possível abrir a prescrição');
    } finally {
      openingInFlight.current = false;
      setIsOpening(false);
      // cycleInProgressRef is intentionally NOT reset here — released only by
      // prescricaoImpressa (FASE 1) or the 60-second safety timeout above.
    }
  }, [atendimento, patient, scriptConfig, refreshDoctorToken]);

  // Reset per-patient refs/state when the patient changes OR when atendimento becomes null
  // (loading phase between patients). Guard removido para que prescriptionOpenedOnce seja
  // resetado imediatamente quando useMedicalWorkflow limpa atendimento ao trocar de paciente,
  // evitando que o container Memed com "Documento emitido e enviado" apareça enquanto P2 carrega.
  // callbackRegistered is intentionally NOT reset here: MdHub has no event.remove,
  // so callbacks are registered once per component mount. onPrintedRef/onDeletedRef
  // always point to the current patient's handlers; resetEmissionGuard() in
  // prepareAndShowPrescription resets per-emission guards before each new emission.
  useEffect(() => {
    autoOpened.current = false;
    openingInFlight.current = false;
    if (cycleLockTimeoutRef.current !== null) {
      clearTimeout(cycleLockTimeoutRef.current);
      cycleLockTimeoutRef.current = null;
    }
    cycleInProgressRef.current = false;
    setPrescriptionOpenedOnce(false);
    setStatusMessage('Preparando prescrição digital…');
  }, [atendimento?.id]);

  // Diagnóstico controlado — só monta se MEMED_DIAG=1 no localStorage. Não afeta fluxo médico.
  useEffect(() => {
    if (globalThis.localStorage?.getItem('MEMED_DIAG')) {
      void import('@/lib/memed/memedDiagnosticTest').then((m) => m.mountDiagnostic());
    }
  }, []);

  useEffect(() => {
    if (!autoOpenWhenReady || !moduleReady || !clinicalReady || !atendimento || autoOpened.current) return;
    autoOpened.current = true;
    void openPrescription();
  }, [autoOpenWhenReady, moduleReady, clinicalReady, atendimento, openPrescription]);

  /**
   * VÁLVULA DE ESCAPE — "Tela travada? → Reiniciar módulo Memed"
   *
   * Ação de RECUPERAÇÃO manual: destrói iframes residuais e recarrega a prescrição do
   * paciente atual do zero. Não é um botão principal — o médico só chega aqui se a
   * tela da Memed travar. Requer clique explícito no link de recuperação no Workspace.
   *
   * NÃO deve ser confundido com o botão "Carregar prescrição" (BOTÃO 2):
   * este apaga o container Memed (destroyMemedContainerChildren) e reabre tudo.
   */
  const resetAndReopen = useCallback(async () => {
    console.log('[MEMED_CYCLE] manual_reset_requested');
    if (cycleLockTimeoutRef.current !== null) {
      clearTimeout(cycleLockTimeoutRef.current);
      cycleLockTimeoutRef.current = null;
    }
    cycleInProgressRef.current = false;
    destroyMemedContainerChildren();
    await openPrescription();
  }, [openPrescription]);

  const loadingModule = !moduleReady || !clinicalReady;
  const readyToOpen = moduleReady && clinicalReady;

  return {
    loadingModule,
    readyToOpen,
    isOpening,
    prescriptionOpenedOnce,
    openPrescription,
    resetAndReopen,
    statusMessage,
  };
}

export { parsePrescriptionPayload };
