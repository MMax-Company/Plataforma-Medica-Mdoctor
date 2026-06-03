import { CheckCircle2, ShieldCheck } from 'lucide-react';

interface EligibilityBannerProps {
  message: string;
  approved?: boolean;
}

export function EligibilityBanner({ message, approved = true }: EligibilityBannerProps) {
  return (
    <section className={`prontuario-eligibility ${approved ? 'prontuario-eligibility--ok' : 'prontuario-eligibility--warn'}`}>
      <div className="flex w-full items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="prontuario-eligibility__icon">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="prontuario-eligibility__title">CRITÉRIOS DE ELEGIBILIDADE</p>
            <p className="prontuario-eligibility__message">{message}</p>
          </div>
        </div>
        <span className="prontuario-eligibility__badge">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          {approved ? 'VERIFICADO' : 'ATENÇÃO'}
        </span>
      </div>
    </section>
  );
}
