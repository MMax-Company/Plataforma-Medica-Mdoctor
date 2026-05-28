import { Check, Eye, Mail, MessageCircle, Play, ShieldAlert, Smartphone } from 'lucide-react';
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
  onSendEmail?: (patientId: string) => void;
  onSendSms?: (patientId: string) => void;
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
  onSendEmail,
  onSendSms,
}: PatientCardProps) {
  const initials = patient.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b-0 pb-1">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EEF4FF] text-sm font-bold text-[#1557FF]">
            {initials || 'DP'}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-semibold text-[#1E1E1E]">{patient.name}</h3>
              <span className="text-xs font-semibold text-[#4A67A1]">#{patient.id.slice(0, 8)}</span>
            </div>
            <p className="mt-1 text-sm text-[#5B6475]">{patient.age} anos</p>
          </div>
          <div className="ml-auto">
            {variant === 'waiting' && <Badge tone="blue">{patient.submittedAt}</Badge>}
            {variant === 'under_review' && <Badge tone="gold">Aguardando validação</Badge>}
            {variant === 'ready' && <Badge tone="green">Receita validada</Badge>}
            {patient.risk === 'high' && <ShieldAlert className="h-4 w-4 text-[#FF2D2D]" aria-hidden="true" />}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-1">
        <div className="space-y-2 text-sm">
          <p className="font-semibold text-[#253044]">{patient.condition}</p>
          <p className="text-[#5B6475]">{patient.requestedMedication}</p>
          {variant === 'waiting' && (
            <p className="inline-flex items-center gap-1 font-medium text-[#0BA84F]">
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              Contato paciente
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 pb-1">
          <Badge tone={patient.paymentStatus === 'paid' ? 'green' : 'gold'}>
            {patient.paymentStatus === 'paid' ? 'Pagamento confirmado' : 'Pagamento pendente'}
          </Badge>
          <Badge>{patient.source}</Badge>
          <Badge tone={riskTone[patient.risk]}>{riskLabel[patient.risk]}</Badge>
        </div>

        {variant === 'waiting' && (
          <Button className="ml-auto w-auto min-w-[110px]" onClick={() => onAttend?.(patient.id)}>
            <Play className="h-4 w-4" aria-hidden="true" />
            Atender
          </Button>
        )}

        {variant === 'under_review' && (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => onViewPrescription?.(patient.id)}>
              <Eye className="h-4 w-4" aria-hidden="true" />
              Visualizar receita
            </Button>
            <Button variant="secondary" onClick={() => onApprove?.(patient.id)}>
              <Check className="h-4 w-4" aria-hidden="true" />
              Aceitar receita
            </Button>
          </div>
        )}

        {variant === 'ready' && (
          <div className="space-y-2">
            <Button variant="success" className="w-full" onClick={() => onSendWhatsApp?.(patient.id)}>
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              Enviar por WhatsApp
            </Button>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" className="px-2 text-xs" onClick={() => onViewPrescription?.(patient.id)}>
                <Eye className="h-4 w-4" aria-hidden="true" />
                Visualizar
              </Button>
              <Button variant="outline" className="px-2 text-xs" onClick={() => onSendEmail?.(patient.id)}>
                <Mail className="h-4 w-4" aria-hidden="true" />
                E-mail
              </Button>
              <Button variant="outline" className="px-2 text-xs" onClick={() => onSendSms?.(patient.id)}>
                <Smartphone className="h-4 w-4" aria-hidden="true" />
                SMS
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
