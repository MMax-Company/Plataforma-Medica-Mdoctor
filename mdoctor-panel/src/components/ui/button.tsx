import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'success' | 'outline' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-[#1557FF] text-white hover:bg-[#0f49df]',
  secondary: 'bg-[#F4B000] text-white hover:bg-[#d99c00]',
  success: 'bg-[#0BA84F] text-white hover:bg-[#099245]',
  outline: 'border border-[#C8D3E2] bg-white text-[#253044] hover:bg-[#F8FAFC]',
  ghost: 'bg-transparent text-[#5B6475] hover:bg-[#EEF4FF] hover:text-[#1557FF]',
};

export function Button({ className, variant = 'primary', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex h-11 items-center justify-center gap-2 rounded-[14px] px-4 text-sm font-semibold shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-all duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
