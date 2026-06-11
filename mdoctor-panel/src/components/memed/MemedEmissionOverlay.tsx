'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { postMemedDiagnosticReport } from '@/services/diagnostics.service';

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
  const cpf = (atendimento.paciente_cpf || '').replace(/\D/g, '');
  if (cpf.length !== 11) missing.push('CPF válido (11 dígitos)');
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
  // Tracks which atendimentoId was successfully bootstrapped.
  // Using an ID (not boolean) prevents auto-open for P2 before its own bootstrap completes.
  const [bootstrappedFor, setBootstrappedFor] = useState<string | null>(null);

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

  const handlePrescriptionPrinted = useCallback(
    async (payload: unknown) => {
      if (!atendimentoId) return;
      const parsed = parsePrescriptionPayload(payload);
      if (!parsed.receitaId && !parsed.pdfUrl && !parsed.receitaUrl) {
        setSaveError('Confirme a emissão na prescrição digital antes de continuar.');
        return;
      }
      setSaveError(null);
      try {
        await saveMemedReceipt({
          atendimentoId,
          receitaId: parsed.receitaId || undefined,
          receitaUrl: parsed.receitaUrl || parsed.digitalLink || undefined,
          pdfUrl: parsed.pdfUrl || undefined,
          digitalLink: parsed.digitalLink || undefined,
          unlockCode: parsed.unlockCode || undefined,
          payload: parsed.raw,
        });
        void validatePrescription(atendimentoId).catch(() => undefined);
        setReceiptSaved(true);
        onComplete();
      } catch (e: unknown) {
        setSaveError(e instanceof Error ? e.message : 'Falha ao persistir receita');
      }
    },
    [atendimentoId, onComplete],
  );

  const refreshDoctorToken = useCallback(async (options?: { force?: boolean }) => {
    const auth = await getMemedToken(options?.force ? { refresh: true } : undefined);
    setDoctorToken(auth.token);
    return auth.token;
  }, []);

  const { loadingModule, readyToOpen, isOpening, prescriptionOpenedOnce, openPrescription, statusMessage } = useMemedSinapse({
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
    autoOpenWhenReady: bootstrappedFor === atendimentoId && !patientBlocked,
  });

  // Reset per-patient state when atendimento changes so P2 starts fresh.
  // bootstrappedFor mismatch gates auto-open until the new bootstrap completes.
  useEffect(() => {
    if (!atendimentoId) return;
    setReceiptSaved(false);
    setSaveError(null);
    setMemedError(null);
  }, [atendimentoId]);

  useEffect(() => {
    if (!atendimentoId || workflow.loading) return;

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

        const currentStatus = String(workflow.atendimento?.status || '').toLowerCase();
        if (['approved', 'receita_em_edicao'].includes(currentStatus)) {
          await startMemedEmission(atendimentoId);
          await workflow.refresh();
        }

        setReceiptSaved(hasPersistedMemedReceipt(workflow.atendimento?.dados_clinicos));
        setBootstrappedFor(atendimentoId);
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
      style={visible ? undefined : { display: 'none' }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 sm:p-5"
    >
      {/* Card modal centralizado — painel visível ao fundo */}
      <div className="relative flex h-full w-full max-h-[min(90vh,800px)] max-w-[840px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#E5EAF2] bg-white px-4 py-2">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#1557FF]">
              Prescrição digital
            </p>
            <h2 className="truncate text-sm font-bold text-[#080D33]">{patientName}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#5B6475] transition hover:bg-[#F0F4FA] hover:text-[#080D33]"
            aria-label="Fechar prescrição"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#F6F9FD] p-2 sm:p-3">
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
              minHeight={380}
            />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
