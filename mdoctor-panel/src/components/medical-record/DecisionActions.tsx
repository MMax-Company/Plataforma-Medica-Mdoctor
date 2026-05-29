import { Check, Edit3, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DecisionActionsProps {
  onReject: () => void;
  onApprove: () => void;
  onEdit: () => void;
  disabled?: boolean;
  loadingAction?: 'approve' | 'reject' | null;
  isEditing?: boolean;
}

export function DecisionActions({
  onReject,
  onApprove,
  onEdit,
  disabled = false,
  loadingAction = null,
  isEditing = false,
}: DecisionActionsProps) {
  const isBusy = disabled || loadingAction !== null;

  return (
    <section className="rounded-[20px] border border-[#E5EAF2] bg-white p-4">
      <div className="mb-4 flex justify-end">
        <Button variant="outline" onClick={onEdit} disabled={isBusy}>
          <Edit3 className="h-4 w-4" aria-hidden="true" />
          {isEditing ? 'Concluir edição' : 'Editar'}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onReject}
          disabled={isBusy}
          className="inline-flex h-[54px] flex-col items-center justify-center rounded-[14px] bg-[#FF2D2D] px-4 text-white transition-colors hover:bg-[#E62828] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="inline-flex items-center gap-2 text-sm font-bold">
            {loadingAction === 'reject' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <X className="h-4 w-4" aria-hidden="true" />
            )}
            Reprovar
          </span>
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={isBusy}
          className="inline-flex h-[54px] flex-col items-center justify-center rounded-[14px] bg-[#0BA84F] px-4 text-white transition-colors hover:bg-[#099245] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="inline-flex items-center gap-2 text-sm font-bold">
            {loadingAction === 'approve' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="h-4 w-4" aria-hidden="true" />
            )}
            Aprovar
          </span>
        </button>
      </div>
    </section>
  );
}
