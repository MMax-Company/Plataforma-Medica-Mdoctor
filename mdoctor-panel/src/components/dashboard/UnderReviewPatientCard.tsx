'use client';

import { Check, Eye } from 'lucide-react';
import { OperationalPatientCardFrame } from '@/components/dashboard/OperationalPatientCardFrame';
import { Button } from '@/components/ui/button';
import type { Patient } from '@/types/panel';

interface UnderReviewPatientCardProps {
  patient: Patient;
  onApprove: (patientId: string) => void;
  onViewPrescription: (patientId: string) => void;
}

export function UnderReviewPatientCard({ patient, onApprove, onViewPrescription }: UnderReviewPatientCardProps) {
  return (
    <OperationalPatientCardFrame
      patient={patient}
      statusLabel="Aguardando validação"
      statusClassName="bg-[#FFF8E0] text-[#9A6A00]"
    >
      <Button type="button" variant="secondary" className="h-10 w-full" onClick={() => onApprove(patient.id)}>
        <Check className="h-4 w-4" aria-hidden="true" />
        Aceitar receita
      </Button>
      <Button type="button" variant="outline" className="h-10 w-full" onClick={() => onViewPrescription(patient.id)}>
        <Eye className="h-4 w-4" aria-hidden="true" />
        Visualizar receita
      </Button>
    </OperationalPatientCardFrame>
  );
}
