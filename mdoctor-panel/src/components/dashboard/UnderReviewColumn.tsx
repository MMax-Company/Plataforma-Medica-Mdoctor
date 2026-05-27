import { Stethoscope } from 'lucide-react';
import { PatientCard } from '@/components/dashboard/PatientCard';
import type { Patient } from '@/types/panel';

interface UnderReviewColumnProps {
  patients: Patient[];
  onApprove: (patientId: string) => void;
  onViewPrescription: (patientId: string) => void;
}

export function UnderReviewColumn({ patients, onApprove, onViewPrescription }: UnderReviewColumnProps) {
  return (
    <section className="min-h-[560px] rounded-lg border border-[#E5EAF2] bg-white">
      <div className="flex items-center justify-between border-b border-[#EEF2F7] px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#FFF8E0] text-[#9A6A00]">
            <Stethoscope className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-[#253044]">Em atendimento</h2>
            <p className="text-xs text-[#5B6475]">Revisao clinica e decisao medica</p>
          </div>
        </div>
        <span className="rounded-md bg-[#F1F5F9] px-2.5 py-1 text-xs font-bold text-[#253044]">{patients.length}</span>
      </div>
      <div className="space-y-3 p-3">
        {patients.map((patient) => (
          <PatientCard
            key={patient.id}
            patient={patient}
            variant="under_review"
            onApprove={onApprove}
            onViewPrescription={onViewPrescription}
          />
        ))}
      </div>
    </section>
  );
}
