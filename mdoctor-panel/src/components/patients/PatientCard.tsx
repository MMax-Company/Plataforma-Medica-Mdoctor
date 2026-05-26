'use client';
import { StatusBadge } from '@/components/ui/StatusBadge';

export interface Patient {
  id: string;
  nome: string;
  telefone: string;
  condition: string;
  status: 'pending' | 'approved' | 'rejected' | 'processing';
  lastPrescription?: string;
}

interface PatientCardProps {
  patient: Patient;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
}

export function PatientCard({ patient, onApprove, onReject }: PatientCardProps) {
  return (
    <div className="bg-white rounded-[20px] p-5 shadow-[0_4px_24px_rgba(0,0,0,0.06)] border border-[#E5EAF2] hover:shadow-lg transition">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-bold text-[#1E1E1E] text-lg">{patient.nome}</h3>
          <p className="text-sm text-[#5B6475]">{patient.telefone}</p>
        </div>
        <StatusBadge status={patient.status} />
      </div>
      <div className="space-y-2 text-sm">
        <p><span className="text-[#5B6475]">Condição:</span> <span className="font-medium text-[#1E1E1E]">{patient.condition}</span></p>
        {patient.lastPrescription && (
          <p><span className="text-[#5B6475]">Última receita:</span> <span className="font-medium">{patient.lastPrescription}</span></p>
        )}
      </div>
      {patient.status === 'pending' && (
        <div className="flex gap-2 mt-4">
          <button onClick={() => onApprove?.(patient.id)} className="flex-1 py-2 bg-[#0BA84F] text-white rounded-[12px] font-semibold hover:bg-[#099445] transition text-sm">
            Aprovar
          </button>
          <button onClick={() => onReject?.(patient.id)} className="flex-1 py-2 bg-[#FF2D2D] text-white rounded-[12px] font-semibold hover:bg-[#E62828] transition text-sm">
            Recusar
          </button>
        </div>
      )}
    </div>
  );
}
