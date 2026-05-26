'use client';

interface DashboardColumnProps {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function DashboardColumn({ title, icon, children, className = '' }: DashboardColumnProps) {
  return (
    <div className={`bg-white rounded-[20px] p-6 shadow-[0_4px_24px_rgba(0,0,0,0.06)] border border-[#E5EAF2] ${className}`}>
      <div className="flex items-center gap-3 mb-4">
        {icon && <span className="text-[#1557FF]">{icon}</span>}
        <h2 className="text-xl font-bold text-[#1E1E1E]">{title}</h2>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}
