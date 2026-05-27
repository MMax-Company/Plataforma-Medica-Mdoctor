'use client';

import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MemedProcessingHeaderProps {
  patientName: string;
  onBack: () => void;
}

export function MemedProcessingHeader({ patientName, onBack }: MemedProcessingHeaderProps) {
  return (
    <header className="border-b border-[#E5EAF2] bg-white px-6 py-5">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" className="h-10 w-10 px-0" onClick={onBack} aria-label="Voltar ao prontuário">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-[#1557FF]" aria-hidden="true" />
              <h1 className="text-xl font-bold tracking-[0.08em] text-[#1E1E1E]">Prescrição Digital Memed</h1>
            </div>
            <p className="mt-1 text-sm text-[#5B6475]">Valide a receita gerada antes de liberar a entrega ao paciente</p>
          </div>
        </div>

        <div className="hidden rounded-lg border border-[#E5EAF2] bg-[#F8FAFC] px-4 py-3 text-right lg:block">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8A94A6]">Paciente</p>
          <p className="text-sm font-semibold text-[#253044]">{patientName}</p>
        </div>
      </div>
    </header>
  );
}
