import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'success' | 'outline' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-[#1557FF] text-white hover:bg-[#0f49df]',
  secondary: 'bg-[#F4B000] text-[#1E1E1E] hover:bg-[#dda000]',
  success: 'bg-[#0BA84F] text-white hover:bg-[#099245]',
  outline: 'border border-[#D9E2F0] bg-white text-[#253044] hover:bg-[#F8FAFC]',
  ghost: 'bg-transparent text-[#5B6475] hover:bg-[#EEF4FF] hover:text-[#1557FF]',
};

export function Button({ className, variant = 'primary', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
