'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/dashboard/Header';
import { QueueColumn } from '@/components/dashboard/QueueColumn';
import { SupportWhatsappBand } from '@/components/dashboard/SupportWhatsappBand';
import { ReadyPrescriptionColumn } from '@/components/dashboard/ReadyPrescriptionColumn';
import { UnderReviewColumn } from '@/components/dashboard/UnderReviewColumn';
import {
  belongsToMedicalWaitingQueue,
  belongsToMemedProcessingQueue,
  belongsToReadyPrescriptionQueue,
} from '@/lib/patient-display';
import { clearSession, getAuthToken } from '@/services/auth.service';
import { useDashboardStore } from '@/stores/useDashboardStore';
import type { DeliveryChannel } from '@/types/panel';

const MOCK_SESSION_KEY = 'mdoctor_panel_mock_session';

const deliverySuccessMessages: Record<DeliveryChannel, string> = {
  whatsapp: 'Receita enviada por WhatsApp com sucesso.',
  email: 'Receita enviada por e-mail com sucesso.',
  sms: 'Receita enviada por SMS com sucesso.',
};

export default function DashboardPage() {
  const router = useRouter();
  const {
    patients,
    supportPatients,
    loading,
    usingMockFallback,
    error,
    loadPatients,
    startReview,
    approvePrescription,
    sendPrescription,
  } = useDashboardStore();
  const [deliveryMessage, setDeliveryMessage] = useState<string | null>(null);
  const [sendingDelivery, setSendingDelivery] = useState<{ patientId: string; channel: DeliveryChannel } | null>(null);
  const [cardFeedback, setCardFeedback] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!getAuthToken() && !window.localStorage.getItem(MOCK_SESSION_KEY)) {
      router.replace('/login');
      return;
    }

    void loadPatients();
  }, [loadPatients, router]);

  const supportWaitingPatients = supportPatients.filter((patient) => patient.status === 'waiting');
  const waitingPatients = patients.filter(belongsToMedicalWaitingQueue);
  const underReviewPatients = patients.filter(belongsToMemedProcessingQueue);
  const readyPatients = patients.filter(belongsToReadyPrescriptionQueue);
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

  const handleSendPrescription = async (patientId: string, channel: DeliveryChannel) => {
    setSendingDelivery({ patientId, channel });
    setDeliveryMessage(null);

    try {
      await sendPrescription(patientId, channel);
      const successText = deliverySuccessMessages[channel];
      setCardFeedback((current) => ({ ...current, [patientId]: successText }));
      setDeliveryMessage(successText);
      window.setTimeout(() => {
        setDeliveryMessage((current) => (current === successText ? null : current));
        setCardFeedback((current) => {
          const next = { ...current };
          delete next[patientId];
          return next;
        });
      }, 3500);
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : 'Falha no envio da receita.';
      setDeliveryMessage(message);
      setCardFeedback((current) => ({ ...current, [patientId]: message }));
    } finally {
      setSendingDelivery(null);
    }
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

          {!loading && <SupportWhatsappBand patients={supportWaitingPatients} onAttend={attendPatient} />}

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
                sendingDelivery={sendingDelivery}
                cardFeedback={cardFeedback}
                onSend={handleSendPrescription}
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
