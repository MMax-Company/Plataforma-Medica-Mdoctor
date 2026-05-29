import Image from 'next/image';
import type { ReactNode } from 'react';

const LOGO_SRC = '/logotipo-mdoctor.png';
const LOGO_WIDTH = 1708;
const LOGO_HEIGHT = 920;

const logoHeights = {
  sm: 'h-10',
  md: 'h-12',
  lg: 'h-16',
} as const;

export function BrandLogo({
  compact = false,
  size,
  showSubtitle = true,
}: {
  compact?: boolean;
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
}) {
  const resolvedSize = size ?? (compact ? 'sm' : 'md');

  return (
    <div className="flex min-w-0 items-center gap-3">
      <Image
        src={LOGO_SRC}
        alt="Doctor Prescreve"
        width={LOGO_WIDTH}
        height={LOGO_HEIGHT}
        className={`w-auto max-w-[min(280px,42vw)] shrink-0 object-contain object-left ${logoHeights[resolvedSize]}`}
        priority
      />
      {showSubtitle && (
        <p
          className={
            resolvedSize === 'lg'
              ? 'text-base font-semibold tracking-[0.14em] text-[#4D5B75]'
              : resolvedSize === 'sm'
                ? 'hidden text-xs font-semibold tracking-[0.14em] text-[#5B6475] sm:block'
                : 'text-xs font-semibold tracking-[0.14em] text-[#5B6475] md:text-sm'
          }
        >
          PAINEL MÉDICO
        </p>
      )}
    </div>
  );
}

export function IconBox({ children, tone = 'blue' }: { children: ReactNode; tone?: 'blue' | 'green' | 'red' | 'gold' | 'soft' }) {
  const tones = {
    blue: 'bg-[#EEF4FF] text-[#1557FF]',
    green: 'bg-emerald-50 text-[#0BA84F]',
    red: 'bg-red-50 text-[#FF2D2D]',
    gold: 'bg-amber-50 text-[#F4B000]',
    soft: 'bg-white text-[#1557FF]',
  };

  return (
    <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] text-xl font-black ${tones[tone]}`}>
      {children}
    </span>
  );
}
