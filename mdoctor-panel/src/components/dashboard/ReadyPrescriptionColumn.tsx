'use client';

import { FileCheck2 } from 'lucide-react';
import { ReadyPrescriptionPatientCard } from '@/components/dashboard/ReadyPrescriptionPatientCard';
import { extractSentDeliveryChannels } from '@/lib/patient-display';
import type { DeliveryChannel, Patient } from '@/types/panel';

interface ReadyPrescriptionColumnProps {
  patients: Patient[];
  sendingDelivery: { patientId: string; channel: DeliveryChannel } | null;
  cardFeedback: Record<string, string>;
  onSend: (patientId: string, channel: DeliveryChannel) => void;
}

export function ReadyPrescriptionColumn({
  patients,
  sendingDelivery,
  cardFeedback,
  onSend,
}: ReadyPrescriptionColumnProps) {
  return (
    <section className="rounded-[20px] border border-[#E5EAF2] bg-white shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between border-b border-[#EEF2F7] px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#EAFBF1] text-[#0BA84F]">
            <FileCheck2 className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-[#253044]">Receitas prontas</h2>
            <p className="text-xs text-[#5B6475]">Receitas validadas para envio</p>
          </div>
        </div>
        <span className="rounded-md bg-[#F1F5F9] px-2.5 py-1 text-xs font-bold text-[#253044]">{patients.length}</span>
      </div>
      <div className="max-h-[calc(100vh-280px)] space-y-3 overflow-y-auto p-3">
        {patients.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-[#5B6475]">Nenhuma receita validada aguardando envio.</p>
        ) : (
          patients.map((patient) => (
            <ReadyPrescriptionPatientCard
              key={patient.id}
              patient={patient}
              sentChannels={extractSentDeliveryChannels(patient)}
              sendingChannel={sendingDelivery?.patientId === patient.id ? sendingDelivery.channel : null}
              feedbackMessage={cardFeedback[patient.id]}
              onSend={onSend}
            />
          ))
        )}
      </div>
    </section>
  );
}
