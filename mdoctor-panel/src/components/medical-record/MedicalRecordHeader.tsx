'use client';

import { ChevronDown, LogOut, Stethoscope } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MedicalRecordHeaderProps {
  onLogout: () => void;
}

export function MedicalRecordHeader({ onLogout }: MedicalRecordHeaderProps) {
  return (
    <header className="border-b border-[#E5EAF2] bg-white">
      <div className="mx-auto flex w-full max-w-[1680px] items-center justify-between gap-4 px-5 py-4 xl:px-7">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[#D9E2F0] bg-[#EEF4FF] text-[#1557FF]">
            <Stethoscope className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <p className="text-2xl font-extrabold leading-none text-[#1B2352]">DOCTOR</p>
            <p className="text-2xl font-extrabold leading-none text-[#F4B000]">PRESCREVE</p>
            <p className="text-xs font-semibold tracking-[0.14em] text-[#5B6475]">PAINEL MEDICO</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-full bg-[#1557FF] px-3 py-2 text-white md:flex">
            <span className="text-sm font-bold">MM</span>
          </div>
          <div className="hidden md:block">
            <p className="text-sm font-bold text-[#1E1E1E]">Dr. Max Matos</p>
            <p className="text-xs font-medium text-[#5B6475]">Médico Cirurgião</p>
          </div>
          <ChevronDown className="hidden h-4 w-4 text-[#5B6475] md:block" aria-hidden="true" />
          <Button variant="outline" className="h-11 bg-[#FADADA] px-4 text-[#1E1E1E] hover:bg-[#F6CACA]" onClick={onLogout}>
            <LogOut className="h-4 w-4" aria-hidden="true" />
            SAIR
          </Button>
        </div>
      </div>
      <div className="h-1 w-full bg-[#F4B000]" />
    </header>
  );
}
