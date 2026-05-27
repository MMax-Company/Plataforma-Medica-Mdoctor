'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/dashboard/Header';
import { MetricCards } from '@/components/dashboard/MetricCards';
import { QueueColumn } from '@/components/dashboard/QueueColumn';
import { ReadyPrescriptionColumn } from '@/components/dashboard/ReadyPrescriptionColumn';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { UnderReviewColumn } from '@/components/dashboard/UnderReviewColumn';
import { clearSession, getAuthToken } from '@/services/auth.service';
import { useDashboardStore } from '@/stores/useDashboardStore';

const MOCK_SESSION_KEY = 'mdoctor_panel_mock_session';

export default function DashboardPage() {
  const router = useRouter();
  const {
    patients,
    metrics,
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

  const logout = () => {
    clearSession();
    window.localStorage.removeItem(MOCK_SESSION_KEY);
    router.replace('/login');
  };

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-[#1E1E1E]">
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />

          <div className="space-y-6 p-6">
            <section className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="text-sm font-semibold text-[#1557FF]">Operacao em tempo real</p>
                <h2 className="mt-1 text-2xl font-semibold text-[#1E1E1E]">Fila medica Doctor Prescreve</h2>
                <p className="mt-2 max-w-2xl text-sm text-[#5B6475]">
                  Primeira versao operacional com dados mockados, pronta para receber Supabase realtime,
                  autenticacao JWT, Memed SDK e WhatsApp API nas proximas etapas.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-lg border border-[#E5EAF2] bg-white px-4 py-3 text-sm text-[#5B6475]">
                  SLA medio <span className="font-semibold text-[#0BA84F]">12 min</span>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="h-11 rounded-md border border-[#D9E2F0] bg-white px-4 text-sm font-semibold text-[#5B6475] transition-colors hover:bg-[#EEF4FF] hover:text-[#1557FF]"
                >
                  Sair
                </button>
              </div>
            </section>

            <MetricCards metrics={metrics} />

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
                />
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
