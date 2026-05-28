import { Check, Edit3, FileCheck2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DecisionActionsProps {
  onReject: () => void;
  onApprove: () => void;
  onEdit: () => void;
  onOpenPrescription: () => void;
}

export function DecisionActions({ onReject, onApprove, onEdit, onOpenPrescription }: DecisionActionsProps) {
  return (
    <section className="rounded-[20px] border border-[#E5EAF2] bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onOpenPrescription}>
            <FileCheck2 className="h-4 w-4" aria-hidden="true" />
            Receita anexada
          </Button>
          <Button variant="outline" onClick={onEdit}>
            <Edit3 className="h-4 w-4" aria-hidden="true" />
            Editar
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:w-[420px]">
          <button
            type="button"
            onClick={onReject}
            className="inline-flex h-[54px] flex-col items-center justify-center rounded-[14px] bg-[#FF2D2D] px-4 text-white transition-colors hover:bg-[#E62828]"
          >
            <span className="inline-flex items-center gap-2 text-sm font-bold">
              <X className="h-4 w-4" aria-hidden="true" />
              REPROVAR
            </span>
            <span className="text-xs font-medium">Não autorizar atendimento</span>
          </button>
          <button
            type="button"
            onClick={onApprove}
            className="inline-flex h-[54px] flex-col items-center justify-center rounded-[14px] bg-[#0BA84F] px-4 text-white transition-colors hover:bg-[#099245]"
          >
            <span className="inline-flex items-center gap-2 text-sm font-bold">
              <Check className="h-4 w-4" aria-hidden="true" />
              APROVAR
            </span>
            <span className="text-xs font-medium">Autorizar atendimento</span>
          </button>
        </div>
      </div>
    </section>
  );
}
