'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { MedicalActionRail } from '@/components/medical/MedicalActionRail';
import { MedicalPatientSidebar } from '@/components/medical/MedicalPatientSidebar';
import { MedicalWorkflowShell } from '@/components/medical/MedicalWorkflowShell';
import { MedicalWorkflowSteps } from '@/components/medical/MedicalWorkflowSteps';
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
import { hasPersistedMemedReceipt } from '@/lib/atendimento-status';

function ReceitaWorkflowContent() {
  const searchParams = useSearchParams();
  const atendimentoId = searchParams.get('atendimentoId') || '';
  const autoEmit = searchParams.get('emit') === '1';

  const workflow = useMedicalWorkflow(atendimentoId);
  const [config, setConfig] = useState<MemedConfig | null>(null);
  const [doctorToken, setDoctorToken] = useState('');
  const [receiptSaved, setReceiptSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [memedError, setMemedError] = useState<string | null>(null);

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
        await workflow.refresh();
      } catch (e: unknown) {
        setSaveError(e instanceof Error ? e.message : 'Falha ao persistir receita');
      }
    },
    [atendimentoId, workflow],
  );

  const refreshDoctorToken = useCallback(async (options?: { force?: boolean }) => {
    const auth = await getMemedToken(options?.force ? { refresh: true } : undefined);
    setDoctorToken(auth.token);
    return auth.token;
  }, []);

  const { loadingModule, readyToOpen, isOpening, openPrescription, statusMessage } = useMemedSinapse({
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
    autoOpenWhenReady: autoEmit,
  });

  useEffect(() => {
    if (!atendimentoId || workflow.loading) return;

    async function bootstrapMemed() {
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
      } catch (e: unknown) {
        setMemedError(e instanceof Error ? e.message : 'Erro ao iniciar prescrição digital');
      }
    }

    void bootstrapMemed();
  }, [atendimentoId, workflow.loading, workflow.atendimento?.status]);

  useEffect(() => {
    setReceiptSaved(hasPersistedMemedReceipt(workflow.atendimento?.dados_clinicos));
  }, [workflow.atendimento?.dados_clinicos?.memed_receita]);

  const steps = useMemo(
    () => [
      {
        id: 'approve',
        label: 'Aprovar',
        done: !workflow.flags.canApprove,
        active: workflow.flags.canApprove,
      },
      {
        id: 'emit',
        label: 'Emitir',
        done: receiptSaved || workflow.hasReceipt,
        active: !workflow.flags.canApprove && !receiptSaved,
      },
      {
        id: 'send',
        label: 'Enviar',
        done: workflow.flags.isDelivered,
        active: receiptSaved && !workflow.flags.isDelivered,
      },
      {
        id: 'finish',
        label: 'Finalizar',
        done: workflow.flags.isDelivered,
        active: workflow.hasReceipt && !workflow.flags.isDelivered,
      },
    ],
    [workflow.flags, receiptSaved, workflow.hasReceipt],
  );

  const handleSave = async () => {
    if (!workflow.atendimento) return;
    const clinical = workflow.atendimento.dados_clinicos || {};
    await workflow.saveClinical({
      conduta: workflow.motivo.trim() || clinical.conduta,
      dados_clinicos: {
        ...clinical,
        conduta: workflow.motivo.trim() || clinical.conduta,
      },
    });
  };

  if (workflow.loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F6F9FD] text-sm text-[#5B6475]">
        Carregando prescrição…
      </main>
    );
  }

  if (!atendimentoId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#F6F9FD] p-6">
        <p className="text-sm text-[#5B6475]">Informe o atendimento na URL (?atendimentoId=).</p>
        <Link href="/fila" className="text-sm font-bold text-[#1557FF]">
          Voltar à fila
        </Link>
      </main>
    );
  }

  return (
    <MedicalWorkflowShell
      title="Prescrição — Doctor Prescreve"
      subtitle="Motor digital integrado. Controle o atendimento pelos botões do painel."
      onOpenQueue={() => {
        window.location.href = '/fila';
      }}
      breadcrumb={(
        <nav className="mb-3 flex flex-wrap items-center gap-2 text-panel-xs font-semibold text-[#5B6475]">
          <Link href="/fila" className="text-[#1557FF] hover:underline">
            Fila
          </Link>
          <span>/</span>
          <Link href={`/fila?atendimentoId=${encodeURIComponent(atendimentoId)}`} className="text-[#1557FF] hover:underline">
            Prontuário
          </Link>
          <span>/</span>
          <span className="text-[#080D33]">Prescrição</span>
        </nav>
      )}
      sidebar={(
        <MedicalPatientSidebar
          atendimento={workflow.atendimento}
          stepHint="Use a barra inferior para aprovar, emitir, enviar e finalizar — sem sair do Doctor Prescreve."
        />
      )}
      actionRail={(
        <MedicalActionRail
          motivo={workflow.motivo}
          onMotivoChange={workflow.setMotivo}
          rejectReasonCode={workflow.rejectReasonCode}
          onRejectReasonChange={workflow.setRejectReasonCode}
          rejectReasons={workflow.rejectReasons}
          actionKey={workflow.actionKey}
          flags={workflow.flags}
          hasReceipt={workflow.hasReceipt || receiptSaved}
          onApprove={() => void workflow.approve()}
          onReject={() => void workflow.reject()}
          onSave={() => void handleSave()}
          onEmit={() => void workflow.openPrescription({ autoEmit: true })}
          onSend={() => void workflow.sendReceipt()}
          onFinish={() => void workflow.finishAttendance()}
          compact
        />
      )}
    >
      {(workflow.error || workflow.toast) && (
        <div
          className={`mb-3 rounded-[10px] border px-3 py-2 text-sm ${
            workflow.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {workflow.error || workflow.toast}
        </div>
      )}

      <MedicalWorkflowSteps steps={steps} />

      <MemedPrescriptionWorkspace
        atendimento={workflow.atendimento}
        containerId={config?.containerId || 'prescricao-memed'}
        statusMessage={statusMessage}
        loadingModule={loadingModule || !doctorToken || !config?.enabled}
        readyToOpen={readyToOpen}
        isOpening={isOpening}
        receiptSaved={receiptSaved}
        saveError={saveError}
        error={memedError}
        onOpenPrescription={openPrescription}
      />
    </MedicalWorkflowShell>
  );
}

export default function ReceitaPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#F6F9FD] p-6 text-sm text-[#5B6475]">Carregando…</main>}>
      <ReceitaWorkflowContent />
    </Suspense>
  );
}
