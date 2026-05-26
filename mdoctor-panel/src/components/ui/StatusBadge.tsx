'use client';

interface StatusBadgeProps {
  status: 'pending' | 'approved' | 'rejected' | 'processing';
  label?: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const config = {
    pending: { bg: 'bg-[#FFF4E5]', text: 'text-[#B4690E]', label: 'Aguardando' },
    approved: { bg: 'bg-[#F0FFF4]', text: 'text-[#0BA84F]', label: 'Aprovado' },
    rejected: { bg: 'bg-[#FFF0F0]', text: 'text-[#FF2D2D]', label: 'Recusado' },
    processing: { bg: 'bg-[#EEF4FF]', text: 'text-[#1557FF]', label: 'Em análise' },
  };
  const c = config[status];
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-[12px] text-xs font-semibold ${c.bg} ${c.text}`}>
      {label || c.label}
    </span>
  );
}
