import type { ReactNode } from 'react';
import { formatQueuePatientId, patientInitials } from '@/lib/patient-display';
import type { Patient } from '@/types/panel';

interface OperationalPatientCardFrameProps {
  patient: Patient;
  statusLabel: string;
  statusClassName: string;
  children: ReactNode;
}

export function OperationalPatientCardFrame({
  patient,
  statusLabel,
  statusClassName,
  children,
}: OperationalPatientCardFrameProps) {
  const initials = patientInitials(patient.name);
  const ageLabel = patient.age > 0 ? `${patient.age} anos` : '—';

  return (
    <article className="rounded-[16px] border border-[#E5EAF2] bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#EEF4FF] text-sm font-bold text-[#1557FF]"
          aria-hidden="true"
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm font-semibold text-[#253044]">#{formatQueuePatientId(patient.id)}</p>
          <p className="mt-0.5 text-sm text-[#5B6475]">{ageLabel}</p>
          <p className={`mt-2 inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${statusClassName}`}>{statusLabel}</p>
        </div>
      </div>
      <div className="mt-4 space-y-2">{children}</div>
    </article>
  );
}
