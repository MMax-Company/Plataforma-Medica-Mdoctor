import { Clock3 } from 'lucide-react';
import { QueuePatientCard } from '@/components/dashboard/QueuePatientCard';
import type { Patient } from '@/types/panel';

interface QueueColumnProps {
  patients: Patient[];
  onAttend: (patientId: string) => void;
}

export function QueueColumn({ patients, onAttend }: QueueColumnProps) {
  return (
    <section className="rounded-[20px] border border-[#E5EAF2] bg-white shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between border-b border-[#EEF2F7] px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#EEF4FF] text-[#1557FF]">
            <Clock3 className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-[#253044]">Fila de espera</h2>
            <p className="text-xs text-[#5B6475]">Elegíveis, pagos e validados</p>
          </div>
        </div>
        <span className="rounded-md bg-[#F1F5F9] px-2.5 py-1 text-xs font-bold text-[#253044]">{patients.length}</span>
      </div>
      <div className="max-h-[calc(100vh-280px)] space-y-3 overflow-y-auto p-3">
        {patients.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-[#5B6475]">Nenhum paciente aguardando na fila médica.</p>
        ) : (
          patients.map((patient) => <QueuePatientCard key={patient.id} patient={patient} onAttend={onAttend} />)
        )}
      </div>
    </section>
  );
}
