'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/dashboard/Header';
import { QueueColumn } from '@/components/dashboard/QueueColumn';
import { ReadyPrescriptionColumn } from '@/components/dashboard/ReadyPrescriptionColumn';
import { UnderReviewColumn } from '@/components/dashboard/UnderReviewColumn';
import { clearSession, getAuthToken } from '@/services/auth.service';
import { useDashboardStore } from '@/stores/useDashboardStore';

const MOCK_SESSION_KEY = 'mdoctor_panel_mock_session';

export default function DashboardPage() {
  const router = useRouter();
  const {
    patients,
    loading,
    usingMockFallback,
    error,
    loadPatients,
    startReview,
    approvePrescription,
    sendWhatsApp,
  } = useDashboardStore();
  const [deliveryMessage, setDeliveryMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!getAuthToken() && !window.localStorage.getItem(MOCK_SESSION_KEY)) {
      router.replace('/login');
      return;
    }

    void loadPatients();
  }, [loadPatients, router]);

  const waitingPatients = patients.filter((patient) => patient.status === 'waiting');
  const underReviewPatients = patients.filter((patient) => patient.status === 'under_review' || patient.status === 'memed_processing');
  const readyPatients = patients.filter((patient) => patient.status === 'ready');
  const operationalPatients = patients.filter(
    (patient) =>
      patient.status === 'waiting' ||
      patient.status === 'under_review' ||
      patient.status === 'memed_processing' ||
      patient.status === 'ready',
  );
  const deliveredCount = patients.filter((patient) => patient.status === 'delivered').length;
  const rejectedCount = patients.filter((patient) => patient.status === 'rejected').length;

  const attendPatient = (patientId: string) => {
    startReview(patientId);
    router.push(`/prontuario/${patientId}`);
  };

  const viewPrescription = (patientId: string) => {
    router.push(`/memed/${patientId}`);
  };

  const sendWhatsAppMock = async (patientId: string) => {
    await sendWhatsApp(patientId);
    setDeliveryMessage('Receita enviada por WhatsApp');
    window.setTimeout(() => setDeliveryMessage(null), 3500);
  };

  const sendEmailMock = async (patientId: string) => {
    await sendWhatsApp(patientId);
    setDeliveryMessage('Receita enviada por e-mail');
    window.setTimeout(() => setDeliveryMessage(null), 3500);
  };

  const sendSmsMock = async (patientId: string) => {
    await sendWhatsApp(patientId);
    setDeliveryMessage('Receita enviada por SMS');
    window.setTimeout(() => setDeliveryMessage(null), 3500);
  };

  const logout = () => {
    clearSession();
    window.localStorage.removeItem(MOCK_SESSION_KEY);
    router.replace('/login');
  };

  const openAnyMedicalRecord = () => {
    const candidate = waitingPatients[0] || underReviewPatients[0] || readyPatients[0];
    if (candidate) {
      router.push(`/prontuario/${candidate.id}`);
      return;
    }
    setDeliveryMessage('Nenhum atendimento disponível para abrir prontuário agora.');
    window.setTimeout(() => setDeliveryMessage(null), 3000);
  };

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-[#1E1E1E]">
      <div className="flex min-h-screen flex-col">
        <Header onLogout={logout} onOpenMedicalRecord={openAnyMedicalRecord} />

        <div className="mx-auto flex w-full max-w-[1680px] flex-1 flex-col space-y-5 p-4 xl:p-6">
          <section className="rounded-[20px] border border-[#E5EAF2] bg-white px-5 py-4 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
            <p className="text-sm font-semibold text-[#1557FF]">Operação em tempo real</p>
            <h2 className="mt-1 text-xl font-bold text-[#1E1E1E]">Painel médico operacional</h2>
            <p className="mt-1 text-sm text-[#5B6475]">Fila de espera, em atendimento e receitas prontas com fluxo staging validado.</p>
          </section>

            {usingMockFallback && error && (
              <div className="rounded-lg border border-[#FFF0BF] bg-[#FFF8E0] px-4 py-3 text-sm font-semibold text-[#8A6200]">
                {error}
              </div>
            )}

            {deliveryMessage && (
              <div className="rounded-lg border border-[#B8E8CC] bg-[#EAFBF1] px-4 py-3 text-sm font-semibold text-[#0B7F3C]">
                {deliveryMessage}
              </div>
            )}

            {loading && (
              <div className="rounded-lg border border-[#E5EAF2] bg-white px-4 py-5 text-sm font-semibold text-[#5B6475]">
                Carregando pacientes...
              </div>
            )}

            {!loading && operationalPatients.length === 0 && (
              <div className="rounded-lg border border-[#E5EAF2] bg-white px-4 py-10 text-center">
                <p className="text-base font-semibold text-[#253044]">Nenhum atendimento operacional ativo</p>
                <p className="mt-2 text-sm text-[#5B6475]">
                  Quando houver pacientes em fila, atendimento ou receita pronta, eles aparecerão aqui.
                </p>
                {(deliveredCount > 0 || rejectedCount > 0) && (
                  <p className="mt-3 text-xs font-semibold text-[#8A94A6]">
                    Entregues: {deliveredCount} · Reprovados: {rejectedCount}
                  </p>
                )}
              </div>
            )}

            {!loading && operationalPatients.length > 0 && (
              <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <QueueColumn patients={waitingPatients} onAttend={attendPatient} />
                <UnderReviewColumn
                  patients={underReviewPatients}
                  onApprove={approvePrescription}
                  onViewPrescription={viewPrescription}
                />
                <ReadyPrescriptionColumn
                  patients={readyPatients}
                  onViewPrescription={viewPrescription}
                  onSendWhatsApp={sendWhatsAppMock}
                  onSendEmail={sendEmailMock}
                  onSendSms={sendSmsMock}
                />
              </section>
            )}
          </div>

        <footer className="mt-auto border-t border-[#E5EAF2] bg-white/80">
          <div className="mx-auto flex w-full max-w-[1680px] flex-wrap items-center justify-center gap-x-5 gap-y-1 px-4 py-3 text-xs font-medium text-[#5B6475]">
            <span>Ambiente protegido LGPD</span>
            <span>Doctor Prescreve - Plataforma de Prescrição Médica</span>
            <span>CNPJ: 50.871.173/0001-53</span>
            <span>© 2026 Todos os direitos reservados.</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
