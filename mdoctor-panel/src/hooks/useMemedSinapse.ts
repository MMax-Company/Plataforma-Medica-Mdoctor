'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MemedConfig } from '@/services/memed.service';
import {
  buildPatientFromAtendimento,
  ensureMemedScript,
  parsePrescriptionPayload,
  prepareAndShowPrescription,
  setupPrescriptionCallback,
  softHideMemed,
  syncMemedScriptToken,
  getMemedScriptId,
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
  openPrescription: () => Promise<void>;
  statusMessage: string;
};

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
      const freshToken = await refreshDoctorToken({ force: true });
      syncMemedScriptToken(getMemedScriptId(), freshToken);
      await ensureMemedScript(freshToken, scriptConfig);

      const { medCount } = await prepareAndShowPrescription(atendimento, patient);
      setStatusMessage(
        medCount > 0
          ? 'Prescrição aberta com paciente e medicamentos. Revise e assine digitalmente.'
          : 'Prescrição aberta com paciente vinculado. Revise e assine digitalmente.',
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
    openPrescription,
    statusMessage,
  };
}

export { parsePrescriptionPayload };
