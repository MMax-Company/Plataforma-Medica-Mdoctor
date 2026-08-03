'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { MemedPrescriptionWorkspace } from '@/components/memed/MemedPrescriptionWorkspace';
import { useMedicalWorkflow } from '@/hooks/useMedicalWorkflow';
import { useMemedSinapse, parsePrescriptionPayload } from '@/hooks/useMemedSinapse';
import {
  getMemedConfig,
  getMemedToken,
  notifyMemedPrescriptionCancelled,
  saveMemedReceipt,
  startMemedEmission,
  type MemedConfig,
} from '@/services/memed.service';
import { validatePrescription } from '@/services/prescriptions';
import { hasPersistedMemedReceipt } from '@/lib/atendimento-status';
import {
  getMemedDiagnosticLog,
  registerMemedDiagnosticReporter,
  unregisterMemedDiagnosticReporter,
} from '@/lib/memed';
import { isValidCpf } from '@/lib/patient-display';
import { postMemedDiagnosticReport } from '@/services/diagnostics.service';
import { getApiBase } from '@/config/api';
import { authHeaders } from '@/services/auth.service';

type Props = {
  atendimentoId: string;
  onClose: () => void;
  onComplete: () => void;
  /** When false the overlay is hidden via CSS but stays mounted, preserving the Memed SDK container. */
  visible?: boolean;
};

function checkPatientReady(atendimento: ReturnType<typeof useMedicalWorkflow>['atendimento']): string[] {
  if (!atendimento) return [];
  const missing: string[] = [];
  if (!atendimento.paciente_nome?.trim()) missing.push('nome');
  if (!isValidCpf(atendimento.paciente_cpf || '')) missing.push('CPF inválido — paciente não pode ser emitido');
  if (!atendimento.paciente_telefone?.trim()) missing.push('telefone');
  return missing;
}

export function MemedEmissionOverlay({ atendimentoId, onClose, onComplete, visible = true }: Props) {
  const workflow = useMedicalWorkflow(atendimentoId);

  const [config, setConfig] = useState<MemedConfig | null>(null);
  const [doctorToken, setDoctorToken] = useState('');
  const [receiptSaved, setReceiptSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [memedError, setMemedError] = useState<string | null>(null);
  // Esconde o overlay inteiro imediatamente após prescricaoImpressa — sem esperar o save.
  const [closing, setClosing] = useState(false);
  const receiptSavedRef = useRef(false);
  const emissionStartedRef = useRef(false);
  // Guard: impede que bootstrap() execute mais de uma vez por atendimentoId.
  // Sem este guard, a mudança de status approved→receita_em_edicao causada por
  // startMemedEmission() + workflow.refresh() re-disparava o efeito e chamava
  // startMemedEmission() duas vezes, gerando race conditions.
  const bootstrapRanRef = useRef(false);

  // Bloqueia o diálogo de impressão do navegador enquanto o overlay está aberto.
  // O botão "Imprimir" da Memed dispara prescricaoImpressa (já capturado) — não queremos
  // que o browser abra o print dialog por cima do painel.
  useEffect(() => {
    const original = window.print.bind(window);
    window.print = () => {};
    return () => {
      window.print = original;
    };
  }, []);

  // Register automatic diagnostic reporter — fires when setPaciente exhausts all retries.
  // Sends full log to backend /api/diagnostics/memed without any manual action from the doctor.
  useEffect(() => {
    const patientName = workflow.atendimento?.paciente_nome;
    registerMemedDiagnosticReporter((error) => {
      void postMemedDiagnosticReport({
        atendimentoId,
        patientName: patientName ?? undefined,
        timestamp: new Date().toISOString(),
        error,
        log: getMemedDiagnosticLog(),
      });
    });
    return () => {
      unregisterMemedDiagnosticReporter();
    };
  }, [atendimentoId, workflow.atendimento?.paciente_nome]);

  const missingPatientFields = useMemo(
    () => checkPatientReady(workflow.atendimento),
    [workflow.atendimento],
  );
  const patientBlocked = missingPatientFields.length > 0;

  const markPending = useCallback(async () => {
    if (receiptSavedRef.current || !emissionStartedRef.current) return;
    try {
      await fetch(`${getApiBase()}/api/atendimentos/${atendimentoId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status: 'memed_processing', notes: 'Emissão Memed não concluída' }),
      });
    } catch { /* best-effort — não bloquear fechamento */ }
  }, [atendimentoId]);

  const handlePrescriptionPrinted = useCallback(
    async (payload: unknown) => {
      console.log('[chain] handlePrescriptionPrinted:start', { atendimentoId });
      if (!atendimentoId) return;
      const parsed = parsePrescriptionPayload(payload);
      if (!parsed.receitaId && !parsed.pdfUrl && !parsed.receitaUrl) {
        console.warn('[chain] handlePrescriptionPrinted:payload-invalido', parsed);
        setSaveError('Receita não pôde ser salva automaticamente. Tente novamente pelo painel.');
        await markPending();
        onComplete();
        return;
      }
      setSaveError(null);
      setClosing(true);
      try {
        console.log('[chain] saveMemedReceipt:start');
        await saveMemedReceipt({
          atendimentoId,
          receitaId: parsed.receitaId || undefined,
          receitaUrl: parsed.receitaUrl || parsed.digitalLink || undefined,
          pdfUrl: parsed.pdfUrl || undefined,
          digitalLink: parsed.digitalLink || undefined,
          unlockCode: parsed.unlockCode || undefined,
          payload: parsed.raw,
        });
        console.log('[chain] saveMemedReceipt:done');
        console.log('[chain] validatePrescription:start');
        void validatePrescription(atendimentoId).catch((err) => {
          console.warn('[chain] validatePrescription:error', err);
        });
        console.log('[chain] validatePrescription:dispatched');
        setReceiptSaved(true);
        receiptSavedRef.current = true;
      } catch (e: unknown) {
        console.error('[chain] saveMemedReceipt:error', e);
        setSaveError(e instanceof Error ? e.message : 'Falha ao persistir receita');
      }
      await markPending();
      console.log('[chain] onComplete:start');
      onComplete();
      console.log('[chain] onComplete:done');
    },
    [atendimentoId, markPending, onComplete],
  );

  const refreshDoctorToken = useCallback(async (options?: { force?: boolean }) => {
    const auth = await getMemedToken(options?.force ? { refresh: true } : undefined);
    setDoctorToken(auth.token);
    return auth.token;
  }, []);

  const { loadingModule, readyToOpen, isOpening, prescriptionOpenedOnce, openPrescription, resetAndReopen, statusMessage } = useMemedSinapse({
    config,
    doctorToken,
    atendimento: workflow.atendimento,
    refreshDoctorToken,
    onPrescriptionPrinted: handlePrescriptionPrinted,
    onPrescriptionDeleted: async (payload) => {
      if (!atendimentoId) return;
      await notifyMemedPrescriptionCancelled(atendimentoId, payload);
      await workflow.refresh();
    },
    autoOpenWhenReady: false,
  });

  // Reset per-patient state when atendimento changes so P2 starts fresh.
  useEffect(() => {
    if (!atendimentoId) return;
    bootstrapRanRef.current = false;
    setClosing(false);
    setReceiptSaved(false);
    receiptSavedRef.current = false;
    emissionStartedRef.current = false;
    setSaveError(null);
    setMemedError(null);
  }, [atendimentoId]);

  useEffect(() => {
    if (!atendimentoId || workflow.loading) return;
    // Guard: executa apenas uma vez por atendimentoId, mesmo que workflow.atendimento?.status
    // mude (ex: approved→receita_em_edicao após startMemedEmission+workflow.refresh()).
    if (bootstrapRanRef.current) return;

    // Aguarda atendimento ser populado — na transição entre pacientes (P1→P2),
    // loading já voltou a false mas atendimento ainda é null. Sem este guard,
    // currentStatus ficaria '' e "Emissão bloqueada" aparecia para todos os P2+.
    if (!workflow.atendimento) return;

    bootstrapRanRef.current = true;

    async function bootstrap() {
      setMemedError(null);
      try {
        const [memedConfig, auth] = await Promise.all([getMemedConfig(), getMemedToken()]);
        setConfig(memedConfig);
        setDoctorToken(auth.token);

        if (!memedConfig.enabled) {
          setMemedError('Prescrição digital indisponível — verifique credenciais no backend.');
          return;
        }

        const currentStatus = workflow.atendimento!.status.toLowerCase();
        const allowedEmissionStatuses = ['approved', 'receita_em_edicao', 'memed_processing'];
        if (!allowedEmissionStatuses.includes(currentStatus)) {
          setMemedError(`Emissão bloqueada — status "${currentStatus}" não autoriza emissão. Aprove o prontuário antes.`);
          return;
        }
        if (['approved', 'receita_em_edicao'].includes(currentStatus)) {
          const emissionResult = await startMemedEmission(atendimentoId) as { success?: boolean } | undefined;
          // 409 retorna { success: false } — status não mudou, não marcamos emissão como iniciada
          if (emissionResult?.success !== false) {
            emissionStartedRef.current = true;
          }
          await workflow.refresh();
        }

        const hasReceipt = hasPersistedMemedReceipt(workflow.atendimento?.dados_clinicos);
        setReceiptSaved(hasReceipt);
        if (hasReceipt) receiptSavedRef.current = true;
      } catch (e: unknown) {
        setMemedError(e instanceof Error ? e.message : 'Erro ao iniciar prescrição digital');
      }
    }

    void bootstrap();
  }, [atendimentoId, workflow.loading, workflow.atendimento?.status]);

  useEffect(() => {
    setReceiptSaved(hasPersistedMemedReceipt(workflow.atendimento?.dados_clinicos));
  }, [workflow.atendimento?.dados_clinicos?.memed_receita]);

  const patientName = workflow.atendimento?.paciente_nome || 'Paciente';

  return (
    <div
      role={visible ? 'dialog' : undefined}
      aria-modal={visible ? 'true' : undefined}
      aria-label={visible ? `Prescrição digital — ${patientName}` : undefined}
      aria-hidden={visible ? undefined : true}
      style={visible && !closing ? undefined : { display: 'none' }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-3"
    >
      {/* Modal compacto: somente a experiência Memed e o controle de fechamento. */}
      <div className="relative flex h-[min(740px,calc(100dvh-96px))] w-[min(860px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10">
        <button
          type="button"
          onClick={() => { void markPending().then(onClose); }}
          className="absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-[#5B6475] shadow ring-1 ring-black/10 transition hover:bg-[#F0F4FA] hover:text-[#080D33]"
          aria-label="Fechar prescrição"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Content */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white p-2">
          {workflow.loading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-[#5B6475]">
              Carregando dados do paciente…
            </div>
          ) : patientBlocked ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4">
              <div className="w-full max-w-md rounded-[14px] border border-amber-200 bg-amber-50 px-5 py-4">
                <p className="text-sm font-bold text-amber-900">
                  Cadastro incompleto para emissão de receita
                </p>
                <p className="mt-1 text-sm text-amber-800">
                  Dados obrigatórios ausentes:{' '}
                  <strong>{missingPatientFields.join(', ')}</strong>
                </p>
                <p className="mt-2 text-xs text-amber-700">
                  Corrija o cadastro do paciente no chatbot antes de aprovar o atendimento.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-sm font-bold text-[#1557FF] hover:underline"
              >
                Voltar ao painel
              </button>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
            <MemedPrescriptionWorkspace
              atendimento={workflow.atendimento}
              containerId={config?.containerId || 'prescricao-memed'}
              statusMessage={statusMessage}
              loadingModule={loadingModule || !doctorToken || !config?.enabled}
              readyToOpen={readyToOpen}
              isOpening={isOpening}
              prescriptionOpenedOnce={prescriptionOpenedOnce}
              receiptSaved={receiptSaved}
              saveError={saveError}
              error={memedError}
              onOpenPrescription={openPrescription}
              onResetMemed={() => void resetAndReopen()}
              minWidth={820}
              minHeight={700}
            />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
