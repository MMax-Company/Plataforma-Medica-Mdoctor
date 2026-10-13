'use client';

import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface PendenciasDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  count: number;
  children: React.ReactNode;
}

// Shell de apresentação puro — nenhuma lógica de dados aqui. A página
// (admin/dashboard) continua sendo a única dona de `grouped.pending` e de
// `handleResolveNote`; este componente só muda o CONTÊINER de "coluna fixa"
// para "painel deslizante", reaproveitando exatamente as mesmas linhas
// (PatientRow) já renderizadas hoje.
export function PendenciasDrawer({ isOpen, onClose, count, children }: Readonly<PendenciasDrawerProps>) {
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Fechar pendências administrativas"
        onClick={onClose}
        className="absolute inset-0 bg-[#0B1220]/40 backdrop-blur-[1px]"
      />
      <aside className="relative flex h-full w-full max-w-[420px] flex-col bg-white shadow-[-8px_0_24px_rgba(15,23,42,0.12)]">
        <div className="flex shrink-0 items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </span>
            <h2 className="truncate text-[13px] font-black tracking-[0.02em] text-[#071B3A]">
              PENDÊNCIAS ADMINISTRATIVAS
            </h2>
            <span className="dp-col-count border-amber-500/30 bg-amber-500 text-white">{count}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-[#5B6475] hover:bg-amber-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>
  );
}
