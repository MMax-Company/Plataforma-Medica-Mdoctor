import { Phone, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { Patient } from '@/types/panel';

interface PatientDataCardProps {
  patient: Patient;
}

export function PatientDataCard({ patient }: PatientDataCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#EEF4FF] text-[#1557FF]">
            <UserRound className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#1E1E1E]">Dados do paciente</h2>
            <p className="text-sm text-[#5B6475]">Identificação e origem do atendimento</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p className="text-2xl font-semibold text-[#1E1E1E]">{patient.name}</p>
          <p className="mt-1 text-sm text-[#5B6475]">{patient.age} anos</p>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2 text-[#253044]">
            <Phone className="h-4 w-4 text-[#1557FF]" aria-hidden="true" />
            <span>{patient.phone}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={patient.paymentStatus === 'paid' ? 'green' : 'gold'}>
              {patient.paymentStatus === 'paid' ? 'Pagamento confirmado' : 'Pagamento pendente'}
            </Badge>
            <Badge>{patient.source}</Badge>
            <Badge>{patient.submittedAt}</Badge>
          </div>
        </div>

        <div className="rounded-lg bg-[#F8FAFC] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8A94A6]">Medicamento solicitado</p>
          <p className="mt-2 text-sm font-semibold text-[#253044]">{patient.requestedMedication}</p>
        </div>
      </CardContent>
    </Card>
  );
}
