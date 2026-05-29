import { FileClock } from 'lucide-react';
import { UnderReviewPatientCard } from '@/components/dashboard/UnderReviewPatientCard';
import type { Patient } from '@/types/panel';

interface UnderReviewColumnProps {
  patients: Patient[];
  onApprove: (patientId: string) => void;
  onViewPrescription: (patientId: string) => void;
}

export function UnderReviewColumn({ patients, onApprove, onViewPrescription }: UnderReviewColumnProps) {
  return (
    <section className="rounded-[20px] border border-[#E5EAF2] bg-white shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between border-b border-[#EEF2F7] px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#FFF8E0] text-[#9A6A00]">
            <FileClock className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-[#253044]">Em atendimento</h2>
            <p className="text-xs text-[#5B6475]">Validação e processamento Memed</p>
          </div>
        </div>
        <span className="rounded-md bg-[#F1F5F9] px-2.5 py-1 text-xs font-bold text-[#253044]">{patients.length}</span>
      </div>
      <div className="max-h-[calc(100vh-280px)] space-y-3 overflow-y-auto p-3">
        {patients.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-[#5B6475]">Nenhuma prescrição em validação no momento.</p>
        ) : (
          patients.map((patient) => (
            <UnderReviewPatientCard
              key={patient.id}
              patient={patient}
              onApprove={onApprove}
              onViewPrescription={onViewPrescription}
            />
          ))
        )}
      </div>
    </section>
  );
}
