import type { ReactNode } from 'react';

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-14 w-14 shrink-0">
        <div className="absolute left-2 top-1 h-8 w-8 rounded-full border-[3px] border-[#1557FF] border-b-[#F4B000]" />
        <div className="absolute bottom-1 left-1 h-7 w-8 rounded-b-full border-b-[3px] border-l-[3px] border-[#080D33]" />
        <div className="absolute bottom-0 right-1 h-4 w-4 rounded-full border-[3px] border-[#080D33] bg-white" />
        <span className="absolute left-0 top-1 h-2 w-2 rounded-full bg-[#1557FF]" />
        <span className="absolute right-3 top-1 h-2 w-2 rounded-full bg-[#1557FF]" />
      </div>
      <div className="leading-none">
        <p className={compact ? 'text-xl font-black italic text-[#080D33]' : 'text-3xl font-black italic text-[#080D33]'}>
          DOCTOR
        </p>
        <p className={compact ? 'text-lg font-black italic text-[#F4B000]' : 'text-2xl font-black italic text-[#F4B000]'}>
          PRESCREVE
        </p>
        <p className={compact ? 'mt-1 text-xs font-bold tracking-wide text-[#26325F]' : 'mt-1 text-lg font-medium tracking-wide text-[#26325F]'}>
          PAINEL MÉDICO
        </p>
      </div>
    </div>
  );
}

export function IconBox({ children, tone = 'blue' }: { children: ReactNode; tone?: 'blue' | 'green' | 'red' | 'gold' | 'soft' }) {
  const tones = {
    blue: 'bg-[#EEF4FF] text-[#1557FF]',
    green: 'bg-emerald-50 text-[#0BA84F]',
    red: 'bg-red-50 text-[#FF2D2D]',
    gold: 'bg-amber-50 text-[#F4B000]',
    soft: 'bg-white text-[#1557FF]'
  };

  return (
    <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] text-xl font-black ${tones[tone]}`}>
      {children}
    </span>
  );
}
