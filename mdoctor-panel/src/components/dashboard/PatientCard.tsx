import { Check, Eye, MessageCircle, Play, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { Patient } from '@/types/panel';

interface PatientCardProps {
  patient: Patient;
  variant: 'waiting' | 'under_review' | 'ready';
  onAttend?: (patientId: string) => void;
  onApprove?: (patientId: string) => void;
  onViewPrescription?: (patientId: string) => void;
  onSendWhatsApp?: (patientId: string) => void;
}

const riskTone = {
  low: 'green',
  medium: 'gold',
  high: 'danger',
} as const;

const riskLabel = {
  low: 'Baixo risco',
  medium: 'Revisar dados',
  high: 'Prioritario',
};

export function PatientCard({
  patient,
  variant,
  onAttend,
  onApprove,
  onViewPrescription,
  onSendWhatsApp,
}: PatientCardProps) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold text-[#1E1E1E]">{patient.name}</h3>
            {patient.risk === 'high' && <ShieldAlert className="h-4 w-4 text-[#FF2D2D]" aria-hidden="true" />}
          </div>
          <p className="mt-1 text-sm text-[#5B6475]">
            {patient.age} anos • {patient.phone}
          </p>
        </div>
        <Badge tone={riskTone[patient.risk]}>{riskLabel[patient.risk]}</Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8A94A6]">Queixa</p>
            <p className="mt-1 font-semibold text-[#253044]">{patient.condition}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8A94A6]">Medicacao</p>
            <p className="mt-1 font-semibold text-[#253044]">{patient.requestedMedication}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={patient.paymentStatus === 'paid' ? 'green' : 'gold'}>
            {patient.paymentStatus === 'paid' ? 'Pagamento confirmado' : 'Pagamento pendente'}
          </Badge>
          <Badge>{patient.source}</Badge>
          <Badge>{patient.submittedAt}</Badge>
        </div>

        {variant === 'waiting' && (
          <Button className="w-full" onClick={() => onAttend?.(patient.id)}>
            <Play className="h-4 w-4" aria-hidden="true" />
            Atender
          </Button>
        )}

        {variant === 'under_review' && (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => onViewPrescription?.(patient.id)}>
              <Eye className="h-4 w-4" aria-hidden="true" />
              Ver dados
            </Button>
            <Button variant="success" onClick={() => onApprove?.(patient.id)}>
              <Check className="h-4 w-4" aria-hidden="true" />
              Aprovar
            </Button>
          </div>
        )}

        {variant === 'ready' && (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => onViewPrescription?.(patient.id)}>
              <Eye className="h-4 w-4" aria-hidden="true" />
              Receita
            </Button>
            <Button variant="success" onClick={() => onSendWhatsApp?.(patient.id)}>
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              WhatsApp
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
