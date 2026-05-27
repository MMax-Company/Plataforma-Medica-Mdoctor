import { ClipboardList, FileCheck2, LayoutDashboard, Settings, Stethoscope } from 'lucide-react';
import { cn } from '@/lib/utils';

const items = [
  { label: 'Dashboard', icon: LayoutDashboard, active: true },
  { label: 'Fila medica', icon: ClipboardList },
  { label: 'Atendimentos', icon: Stethoscope },
  { label: 'Receitas', icon: FileCheck2 },
  { label: 'Configuracoes', icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-[#E5EAF2] bg-white p-5 xl:block">
      <div className="mb-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1557FF] text-lg font-bold text-white">
          DP
        </div>
        <p className="mt-3 text-sm font-semibold text-[#1E1E1E]">Operacao clinica</p>
        <p className="text-xs text-[#5B6475]">Ambiente medico</p>
      </div>

      <nav className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <button
              key={item.label}
              className={cn(
                'flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-semibold transition-colors',
                item.active ? 'bg-[#EEF4FF] text-[#1557FF]' : 'text-[#5B6475] hover:bg-[#F8FAFC] hover:text-[#253044]',
              )}
              type="button"
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
