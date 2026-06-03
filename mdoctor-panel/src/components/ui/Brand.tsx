import Image from 'next/image';
import type { ReactNode } from 'react';

const LOGO_SRC = '/doctor-prescreve-logo-transparent.png';
const LOGO_FALLBACK = '/doctor-prescreve-logo.png';
const LOGO_WIDTH = 512;
const LOGO_HEIGHT = 128;

const logoHeights = {
  sm: 'h-8',
  md: 'h-9',
  lg: 'h-11',
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
    <div className="flex min-w-0 items-center gap-2">
      <Image
        src={LOGO_SRC}
        alt="Doctor Prescreve"
        width={LOGO_WIDTH}
        height={LOGO_HEIGHT}
        unoptimized
        className={`w-auto shrink-0 bg-transparent object-contain object-left ${logoHeights[resolvedSize]} ${
          compact ? 'max-w-[132px]' : 'max-w-[180px]'
        }`}
        priority
        onError={(e) => {
          const img = e.currentTarget;
          if (!img.src.includes('doctor-prescreve-logo.png')) {
            img.src = LOGO_FALLBACK;
          }
        }}
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
