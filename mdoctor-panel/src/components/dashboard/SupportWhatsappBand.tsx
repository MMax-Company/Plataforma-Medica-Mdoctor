'use client';

import { Headphones } from 'lucide-react';
import { PatientCard } from '@/components/dashboard/PatientCard';
import type { Patient } from '@/types/panel';

interface SupportWhatsappBandProps {
  patients: Patient[];
  onAttend: (patientId: string) => void;
}

export function SupportWhatsappBand({ patients, onAttend }: SupportWhatsappBandProps) {
  return (
    <section className="rounded-[20px] border border-[#D4E4FF] bg-gradient-to-r from-[#F5F9FF] to-white shadow-[0_4px_14px_rgba(21,87,255,0.06)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#D4E4FF] px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#1557FF] text-white">
            <Headphones className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-[#1557FF]">
              SUPORTE MÉDICO VIA WHATSAPP
            </h2>
            <p className="text-xs text-[#5B6475]">Fila humana separada da fila médica e prescrição</p>
          </div>
        </div>
        <span className="rounded-md bg-[#EEF4FF] px-2.5 py-1 text-xs font-bold text-[#1557FF]">{patients.length}</span>
      </div>
      <div className="max-h-[220px] space-y-3 overflow-y-auto p-3">
        {patients.length === 0 ? (
          <p className="px-2 py-4 text-center text-sm text-[#5B6475]">Nenhum paciente aguardando suporte no momento.</p>
        ) : (
          patients.map((patient) => (
            <PatientCard key={patient.id} patient={patient} variant="waiting" onAttend={onAttend} />
          ))
        )}
      </div>
    </section>
  );
}
