import { AlertTriangle, CheckCircle2 } from 'lucide-react';

interface EligibilityBannerProps {
  message: string;
  criteria: string[];
  approved?: boolean;
  riskStatus?: string;
  renewalStatus?: string;
  protocolVersion?: string;
}

export function EligibilityBanner({
  message,
  criteria,
  approved = true,
  riskStatus,
  renewalStatus,
  protocolVersion,
}: EligibilityBannerProps) {
  const positive = approved;
  return (
    <section className={`rounded-[14px] border p-4 ${positive ? 'border-[#B8E8CC] bg-[#EAFBF1]' : 'border-[#FFD3D3] bg-[#FFF1F1]'}`}>
      <div className="flex items-start gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white ${positive ? 'text-[#0BA84F]' : 'text-[#D93434]'}`}>
          {positive ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> : <AlertTriangle className="h-5 w-5" aria-hidden="true" />}
        </div>
        <div className="flex w-full items-start justify-between gap-3">
          <div>
            <p className={`font-semibold ${positive ? 'text-[#0B7F3C]' : 'text-[#9B1C1C]'}`}>{message}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {criteria.map((item) => (
                <span
                  key={item}
                  className={`rounded-md bg-white px-2.5 py-1 text-xs font-semibold ${positive ? 'text-[#0B7F3C]' : 'text-[#9B1C1C]'}`}
                >
                  {item}
                </span>
              ))}
              {riskStatus ? <span className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-[#253044]">Risco: {riskStatus}</span> : null}
              {renewalStatus ? (
                <span className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-[#253044]">Renovação: {renewalStatus}</span>
              ) : null}
              {protocolVersion ? (
                <span className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-[#5B6475]">Protocolo: {protocolVersion}</span>
              ) : null}
            </div>
          </div>
          <span className={`rounded-xl px-3 py-1 text-xs font-bold ${positive ? 'bg-[#D6F4E2] text-[#0B7F3C]' : 'bg-[#FFE4E4] text-[#9B1C1C]'}`}>
            {positive ? 'VERIFICADO' : 'ATENÇÃO CLÍNICA'}
          </span>
        </div>
      </div>
    </section>
  );
}
