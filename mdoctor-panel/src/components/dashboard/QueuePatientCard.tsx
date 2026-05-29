'use client';

import { MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatQueuePatientId, patientInitials, whatsappContactUrl } from '@/lib/patient-display';
import type { Patient } from '@/types/panel';

interface QueuePatientCardProps {
  patient: Patient;
  onAttend: (patientId: string) => void;
}

export function QueuePatientCard({ patient, onAttend }: QueuePatientCardProps) {
  const initials = patientInitials(patient.name);
  const whatsappUrl = whatsappContactUrl(patient.phone);
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
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {whatsappUrl ? (
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 flex-1 min-w-[120px] items-center justify-center gap-2 rounded-[14px] border border-[#C8D3E2] bg-white px-3 text-sm font-semibold text-[#253044] transition-colors hover:bg-[#F8FAFC]"
            aria-label="Contato WhatsApp do paciente"
          >
            <MessageCircle className="h-4 w-4 text-[#25D366]" aria-hidden="true" />
            WhatsApp
          </a>
        ) : (
          <Button type="button" variant="outline" className="h-10 flex-1 min-w-[120px]" disabled>
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            WhatsApp
          </Button>
        )}
        <Button type="button" variant="primary" className="h-10 min-w-[110px] flex-1" onClick={() => onAttend(patient.id)}>
          Atender
        </Button>
      </div>
    </article>
  );
}
