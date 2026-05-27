import { Check, Eye, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PrescriptionActionsProps {
  onView: () => void;
  onAccept: () => void;
  onBack: () => void;
}

export function PrescriptionActions({ onView, onAccept, onBack }: PrescriptionActionsProps) {
  return (
    <section className="rounded-lg border border-[#E5EAF2] bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Button variant="outline" onClick={onView}>
          <Eye className="h-4 w-4" aria-hidden="true" />
          Visualizar Receita
        </Button>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:w-[420px]">
          <Button variant="outline" onClick={onBack}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Voltar ao Prontuário
          </Button>
          <Button variant="secondary" onClick={onAccept}>
            <Check className="h-4 w-4" aria-hidden="true" />
            Aceitar Receita
          </Button>
        </div>
      </div>
    </section>
  );
}
