import { CheckCircle2 } from 'lucide-react';

interface EligibilityBannerProps {
  message: string;
  criteria: string[];
}

export function EligibilityBanner({ message, criteria }: EligibilityBannerProps) {
  return (
    <section className="rounded-[14px] border border-[#B8E8CC] bg-[#EAFBF1] p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white text-[#0BA84F]">
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="flex w-full items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-[#0B7F3C]">{message}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {criteria.map((item) => (
                <span key={item} className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-[#0B7F3C]">
                  {item}
                </span>
              ))}
            </div>
          </div>
          <span className="rounded-xl bg-[#D6F4E2] px-3 py-1 text-xs font-bold text-[#0B7F3C]">VERIFICADO</span>
        </div>
      </div>
    </section>
  );
}
