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
    <section className="rounded-lg border border-[#E5EAF2] bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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

        <div className="grid grid-cols-2 gap-2 lg:w-[360px]">
          <button
            type="button"
            onClick={onReject}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#FF2D2D] px-4 text-sm font-bold text-white transition-colors hover:bg-[#E62828]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            REPROVAR
          </button>
          <button
            type="button"
            onClick={onApprove}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#0BA84F] px-4 text-sm font-bold text-white transition-colors hover:bg-[#099245]"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            APROVAR
          </button>
        </div>
      </div>
    </section>
  );
}
