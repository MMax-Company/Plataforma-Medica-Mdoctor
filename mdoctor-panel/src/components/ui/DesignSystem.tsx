import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

type Tone = 'primary' | 'secondary' | 'success' | 'danger' | 'gold' | 'soft';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

const buttonTone: Record<Tone, string> = {
  primary: 'border-[#1557FF] bg-[#1557FF] text-white hover:bg-[#0f46d8]',
  secondary: 'border-[#1E1E1E] bg-white text-[#1E1E1E] hover:bg-[#F8FAFC]',
  success: 'border-[#0BA84F] bg-[#0BA84F] text-white hover:bg-[#089244]',
  danger: 'border-[#FF2D2D] bg-[#FF2D2D] text-white hover:bg-[#df2424]',
  gold: 'border-[#F4B000] bg-[#F4B000] text-white hover:bg-[#d89b00]',
  soft: 'border-[#E5EAF2] bg-white text-[#1E1E1E] hover:bg-[#F8FAFC]'
};

export function Button({
  className,
  tone = 'primary',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return (
    <button
      className={cx(
        'inline-flex h-10 items-center justify-center rounded-xl border px-3.5 text-panel-sm font-bold shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition duration-200 hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-50',
        buttonTone[tone],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({
  className,
  children
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cx('rounded-[20px] border border-[#E5EAF2] bg-white shadow-[0_4px_14px_rgba(0,0,0,0.04)]', className)}>
      {children}
    </section>
  );
}

export function AppShell({
  title,
  subtitle,
  children,
  actions,
  userLabel,
  onLogout
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  userLabel?: string;
  onLogout?: () => void;
}) {
  return (
    <main className="min-h-screen bg-[#F8FAFC] text-[#1E1E1E]">
      <header className="flex min-h-[4.5rem] flex-col gap-3 bg-white px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[#1557FF] text-sm font-black text-white">
            DP
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.08em] text-[#1557FF]">Doctor Prescreve</p>
            <h1 className="truncate text-panel-lg font-black">{title}</h1>
            {subtitle && <p className="text-sm text-[#5B6475]">{subtitle}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {userLabel && (
            <span className="rounded-[14px] border border-[#E5EAF2] bg-white px-4 py-3 text-xs font-bold text-[#1E1E1E]">
              {userLabel}
            </span>
          )}
          {onLogout && (
            <Button onClick={onLogout} tone="soft" className="h-10 text-xs">
              Sair
            </Button>
          )}
        </div>
      </header>
      <div className="h-1 bg-[#F4B000]" />
      <section className="dp-panel-shell">{children}</section>
    </main>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        'h-11 w-full rounded-[14px] border border-[#E5EAF2] bg-white px-4 text-sm text-[#1E1E1E] outline-none transition focus:border-[#1557FF] focus:ring-4 focus:ring-[#EEF4FF]',
        className
      )}
      {...props}
    />
  );
}

export function SelectInput({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        'h-11 w-full rounded-[14px] border border-[#E5EAF2] bg-white px-4 text-sm text-[#1E1E1E] outline-none transition focus:border-[#1557FF] focus:ring-4 focus:ring-[#EEF4FF]',
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function StatusPill({
  children,
  tone = 'primary',
  className
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  const tones: Record<Tone, string> = {
    primary: 'bg-[#EEF4FF] text-[#1557FF]',
    secondary: 'bg-[#F8FAFC] text-[#5B6475]',
    success: 'bg-emerald-50 text-[#0BA84F]',
    danger: 'bg-red-50 text-[#FF2D2D]',
    gold: 'bg-amber-50 text-[#B57700]',
    soft: 'bg-[#FADADA] text-[#1E1E1E]'
  };

  return <span className={cx('inline-flex items-center rounded-[12px] px-3 py-1 text-xs font-bold', tones[tone], className)}>{children}</span>;
}

export function AlertBanner({
  tone = 'secondary',
  title,
  children
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}) {
  const tones: Record<Tone, string> = {
    primary: 'border-[#BFD0FF] bg-[#EEF4FF] text-[#1557FF]',
    secondary: 'border-[#E5EAF2] bg-white text-[#5B6475]',
    success: 'border-emerald-200 bg-emerald-50 text-[#0BA84F]',
    danger: 'border-red-200 bg-red-50 text-red-800',
    gold: 'border-amber-200 bg-amber-50 text-[#B57700]',
    soft: 'border-[#FADADA] bg-[#FADADA] text-[#1E1E1E]'
  };

  return (
    <div className={cx('rounded-[14px] border px-4 py-3 text-sm shadow-[0_2px_8px_rgba(0,0,0,0.04)]', tones[tone])}>
      {title && <p className="font-black text-[#1E1E1E]">{title}</p>}
      <div className={title ? 'mt-1 leading-6' : 'leading-6'}>{children}</div>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="text-xs font-black uppercase tracking-[0.08em] text-[#1557FF]">{eyebrow}</p>}
        <h1 className="mt-1 text-panel-2xl font-black text-[#1E1E1E]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm leading-6 text-[#5B6475]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function MetricCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-bold text-[#5B6475]">{label}</p>
      <p className="mt-2 text-2xl font-black text-[#1E1E1E]">{value}</p>
    </Card>
  );
}

export function EmptyState({
  title,
  description
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="rounded-[20px] border border-dashed border-[#E5EAF2] bg-white p-5 text-center">
      <p className="text-sm font-black text-[#1E1E1E]">{title}</p>
      {description && <p className="mt-1 text-sm leading-6 text-[#5B6475]">{description}</p>}
    </div>
  );
}

export function FieldRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[#E5EAF2] pb-2 last:border-0">
      <dt className="text-[#5B6475]">{label}</dt>
      <dd className="max-w-[240px] truncate text-right font-bold text-[#1E1E1E]">{value}</dd>
    </div>
  );
}
