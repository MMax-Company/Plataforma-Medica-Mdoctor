import { CheckCircle2 } from 'lucide-react';

interface EligibilityBannerProps {
  message: string;
  approved?: boolean;
}

export function EligibilityBanner({ message, approved = true }: EligibilityBannerProps) {
  return (
    <section className={`rounded-[14px] border p-4 ${approved ? 'border-[#B8E8CC] bg-[#EAFBF1]' : 'border-[#FFD3D3] bg-[#FFF1F1]'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white ${approved ? 'text-[#0BA84F]' : 'text-[#D93434]'}`}>
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className={`text-sm font-semibold leading-6 ${approved ? 'text-[#0B7F3C]' : 'text-[#9B1C1C]'}`}>{message}</p>
        </div>
        <span className={`shrink-0 rounded-xl px-3 py-1 text-xs font-bold ${approved ? 'bg-[#D6F4E2] text-[#0B7F3C]' : 'bg-[#FFE4E4] text-[#9B1C1C]'}`}>
          {approved ? 'VERIFICADO' : 'ATENÇÃO'}
        </span>
      </div>
    </section>
  );
}
