import { FileCheck2 } from 'lucide-react';
import { PatientCard } from '@/components/dashboard/PatientCard';
import type { Patient } from '@/types/panel';

interface ReadyPrescriptionColumnProps {
  patients: Patient[];
  onViewPrescription: (patientId: string) => void;
  onSendWhatsApp: (patientId: string) => void;
}

export function ReadyPrescriptionColumn({ patients, onViewPrescription, onSendWhatsApp }: ReadyPrescriptionColumnProps) {
  return (
    <section className="min-h-[560px] rounded-lg border border-[#E5EAF2] bg-white">
      <div className="flex items-center justify-between border-b border-[#EEF2F7] px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#EAFBF1] text-[#0BA84F]">
            <FileCheck2 className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-[#253044]">Receitas prontas</h2>
            <p className="text-xs text-[#5B6475]">Disponiveis para envio ao paciente</p>
          </div>
        </div>
        <span className="rounded-md bg-[#F1F5F9] px-2.5 py-1 text-xs font-bold text-[#253044]">{patients.length}</span>
      </div>
      <div className="space-y-3 p-3">
        {patients.map((patient) => (
          <PatientCard
            key={patient.id}
            patient={patient}
            variant="ready"
            onViewPrescription={onViewPrescription}
            onSendWhatsApp={onSendWhatsApp}
          />
        ))}
      </div>
    </section>
  );
}
