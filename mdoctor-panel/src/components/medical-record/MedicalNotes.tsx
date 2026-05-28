'use client';

import { TextareaHTMLAttributes } from 'react';

interface MedicalNotesProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export function MedicalNotes({ label = 'CONDUTA MÉDICA OPCIONAL', ...props }: MedicalNotesProps) {
  return (
    <label className="block rounded-lg border border-[#E5EAF2] bg-white p-4">
      <span className="text-sm font-semibold text-[#253044]">{label}</span>
      <textarea
        className="mt-3 min-h-32 w-full resize-none rounded-md border border-[#D9E2F0] bg-[#F8FAFC] p-3 text-sm text-[#253044] outline-none transition-colors placeholder:text-[#8A94A6] focus:border-[#1557FF] focus:bg-white"
        placeholder="Digite aqui orientações adicionais, observações ou justificativas (opcional)..."
        {...props}
      />
    </label>
  );
}
