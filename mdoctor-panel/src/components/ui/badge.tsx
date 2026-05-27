import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type BadgeTone = 'blue' | 'gold' | 'green' | 'danger' | 'neutral';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const tones: Record<BadgeTone, string> = {
  blue: 'bg-[#EEF4FF] text-[#1557FF]',
  gold: 'bg-[#FFF8E0] text-[#9A6A00]',
  green: 'bg-[#EAFBF1] text-[#0BA84F]',
  danger: 'bg-[#FFECEC] text-[#FF2D2D]',
  neutral: 'bg-[#F1F5F9] text-[#5B6475]',
};

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn('inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold', tones[tone], className)}
      {...props}
    />
  );
}
