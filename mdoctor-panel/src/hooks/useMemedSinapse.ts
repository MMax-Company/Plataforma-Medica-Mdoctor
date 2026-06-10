'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MemedConfig } from '@/services/memed.service';
import {
  applyClinicalMemedUx,
  buildPatientFromAtendimento,
  ensureMemedScript,
  getLastMemedToken,
  parsePrescriptionPayload,
  prepareAndShowPrescription,
  setupPrescriptionCallback,
  softHideMemed,
  syncMemedScriptToken,
  getMemedScriptId,
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
  statusMessage: string;
};

// 90s cobre o pior caso: newPrescription(15s) + setPaciente_first(12s) + retry(30s) + addItem(20s) + buffer
const MEMED_OPEN_TIMEOUT_MS = 90_000;

// Garante que applyClinicalMemedUx rode UMA VEZ por sessão de browser.
// Se chamado a cada novo overlay (per hook instance), os comandos setFeatureToggle
// correm concorrentemente com setPaciente do segundo paciente e bloqueiam a troca.
let clinicalUxApplied = false;

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
  const [prescriptionOpenedOnce, setPrescriptionOpenedOnce] = useState(false);
  const callbackRegistered = useRef(false);
  const autoOpened = useRef(false);
  const openingInFlight = useRef(false);
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
      setupPrescriptionCallback({
        onPrescriptionPrinted: (payload) => onPrintedRef.current(payload),
        onPrescriptionDeleted: onDeletedRef.current ? (p) => onDeletedRef.current?.(p) : undefined,
      });
      callbackRegistered.current = true;
      // applyClinicalMemedUx apenas na primeira vez: toggles setFeatureToggle rodando
      // concorrentemente com setPaciente do segundo paciente bloqueiam a troca de paciente.
      if (!clinicalUxApplied) {
        clinicalUxApplied = true;
        void applyClinicalMemedUx().catch(() => undefined);
      }
    }

    setClinicalReady(true);
    setStatusMessage('Pronto para emitir. Assinatura digital ativa na sessão do turno.');
  }, [moduleReady, patient, atendimento?.id]);

  const openPrescription = useCallback(async () => {
    if (!atendimento || !patient || !scriptConfig) {
      setStatusMessage('Atendimento ou configuração de prescrição incompletos.');
      return;
    }
    if (openingInFlight.current) return;

    openingInFlight.current = true;
    setIsOpening(true);
    try {
      setStatusMessage('Aplicando dados clínicos e abrindo prescrição…');
      const result = await withTimeout(
        (async () => {
          const moduleAlreadyReady = isMemedRuntimeReady();
          const freshToken = await refreshDoctorToken({ force: !moduleAlreadyReady });
          if (freshToken !== getLastMemedToken() && freshToken !== tokenRef.current) {
            syncMemedScriptToken(getMemedScriptId(), freshToken);
          }
          await ensureMemedScript(freshToken, scriptConfig);
          return prepareAndShowPrescription(atendimento, patient);
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
      setStatusMessage(error instanceof Error ? error.message : 'Não foi possível abrir a prescrição');
    } finally {
      openingInFlight.current = false;
      setIsOpening(false);
    }
  }, [atendimento, patient, scriptConfig, refreshDoctorToken]);

  useEffect(() => {
    if (!autoOpenWhenReady || !moduleReady || !clinicalReady || !atendimento || autoOpened.current) return;
    autoOpened.current = true;
    void openPrescription();
  }, [autoOpenWhenReady, moduleReady, clinicalReady, atendimento, openPrescription]);

  const loadingModule = !moduleReady || !clinicalReady;
  const readyToOpen = moduleReady && clinicalReady;

  return {
    loadingModule,
    readyToOpen,
    isOpening,
    prescriptionOpenedOnce,
    openPrescription,
    statusMessage,
  };
}

export { parsePrescriptionPayload };
