'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { MedicalWorkflowShell } from '@/components/medical/MedicalWorkflowShell';
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

function checkPatientReady(atendimento: ReturnType<typeof useMedicalWorkflow>['atendimento']): string[] {
  if (!atendimento) return [];
  const missing: string[] = [];
  if (!atendimento.paciente_nome?.trim()) missing.push('nome');
  const cpf = (atendimento.paciente_cpf || '').replace(/\D/g, '');
  if (cpf.length !== 11) missing.push('CPF válido (11 dígitos)');
  if (!atendimento.paciente_telefone?.trim()) missing.push('telefone');
  return missing;
}

function ReceitaWorkflowContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const atendimentoId = searchParams.get('atendimentoId') || '';
  const autoEmit = searchParams.get('emit') === '1';

  const workflow = useMedicalWorkflow(atendimentoId);
  const [config, setConfig] = useState<MemedConfig | null>(null);
  const [doctorToken, setDoctorToken] = useState('');
  const [receiptSaved, setReceiptSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [memedError, setMemedError] = useState<string | null>(null);
  const [statusBlocked, setStatusBlocked] = useState(true);

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
        // Avança status para validated/ready — paciente vai direto para RECEITAS PRONTAS.
        // Não aguarda: falha não impede retorno ao painel.
        void validatePrescription(atendimentoId).catch(() => undefined);
        router.push('/fila');
      } catch (e: unknown) {
        setSaveError(e instanceof Error ? e.message : 'Falha ao persistir receita');
      }
    },
    [atendimentoId, router],
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
    // Bloquear auto-abertura se dados cadastrais insuficientes para emissão segura.
    autoOpenWhenReady: autoEmit && !patientBlocked && !statusBlocked,
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
        const allowedEmissionStatuses = ['approved', 'receita_em_edicao', 'memed_processing'];
        if (!allowedEmissionStatuses.includes(currentStatus)) {
          setMemedError('Acesso negado — status não autorizado para emissão. Retorne à fila.');
          return;
        }
        setStatusBlocked(false);
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

  // Bloquear emissão se dados obrigatórios ausentes — segurança contra receita no paciente errado.
  if (!workflow.loading && patientBlocked) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#F6F9FD] p-6">
        <div className="w-full max-w-md rounded-[14px] border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-sm font-bold text-amber-900">Cadastro incompleto para emissão de receita</p>
          <p className="mt-1 text-sm text-amber-800">
            Dados obrigatórios ausentes: <strong>{missingPatientFields.join(', ')}</strong>
          </p>
          <p className="mt-2 text-xs text-amber-700">
            Corrija o cadastro do paciente no chatbot antes de aprovar o atendimento.
          </p>
        </div>
        <Link href="/fila" className="text-sm font-bold text-[#1557FF]">
          Voltar à fila
        </Link>
      </main>
    );
  }

  return (
    <MedicalWorkflowShell
      title="Prescrição digital"
      onOpenQueue={() => { window.location.href = '/fila'; }}
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
        minHeight={380}
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
