import { Bell, Search, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function Header() {
  return (
    <header className="flex min-h-16 items-center justify-between border-b border-[#E5EAF2] bg-white px-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1557FF]">Doctor Prescreve</p>
        <h1 className="text-xl font-semibold text-[#1E1E1E]">Painel medico operacional</h1>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden h-10 w-[320px] items-center gap-2 rounded-md border border-[#D9E2F0] bg-[#F8FAFC] px-3 text-sm text-[#5B6475] lg:flex">
          <Search className="h-4 w-4" aria-hidden="true" />
          <span>Buscar paciente, telefone ou medicamento</span>
        </div>
        <Button variant="outline" className="h-10 w-10 px-0" aria-label="Notificacoes">
          <Bell className="h-4 w-4" aria-hidden="true" />
        </Button>
        <div className="flex items-center gap-2 rounded-md border border-[#D9E2F0] bg-white px-3 py-2">
          <ShieldCheck className="h-4 w-4 text-[#0BA84F]" aria-hidden="true" />
          <span className="text-sm font-semibold text-[#253044]">Dr. Max Matos</span>
        </div>
      </div>
    </header>
  );
}
