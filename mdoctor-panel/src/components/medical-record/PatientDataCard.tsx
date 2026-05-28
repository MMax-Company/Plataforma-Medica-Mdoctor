import { AtSign, CalendarDays, LocateFixed, MapPin, Phone, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { Patient } from '@/types/panel';

interface PatientDataCardProps {
  patient: Patient;
}

export function PatientDataCard({ patient }: PatientDataCardProps) {
  const initials = patient.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-bold text-[#1E1E1E]">DADOS DO PACIENTE</h2>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl border border-[#E5EAF2] bg-[#F8FAFC] p-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#EEF4FF] text-lg font-bold text-[#1557FF]">
            {initials || 'DP'}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xl font-bold text-[#1E1E1E]">{patient.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge tone="blue">{patient.age} anos</Badge>
              <span className="text-sm font-semibold text-[#4A67A1]">Prontuário: #{patient.id.slice(0, 8)}</span>
            </div>
            <p className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[#0BA84F]">
              <Phone className="h-4 w-4" aria-hidden="true" />
              Contato via WhatsApp
            </p>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-[#E5EAF2] bg-white p-3 text-sm">
          <div className="flex items-center justify-between gap-2 text-[#253044]">
            <span className="inline-flex items-center gap-2 text-[#5B6475]">
              <CalendarDays className="h-4 w-4" />
              Data de nascimento
            </span>
            <span className="font-semibold">15/04/1988</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-[#253044]">
            <span className="inline-flex items-center gap-2 text-[#5B6475]">
              <UserRound className="h-4 w-4" />
              CPF
            </span>
            <span className="font-semibold">123.456.789-10</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-[#253044]">
            <span className="inline-flex items-center gap-2 text-[#5B6475]">
              <AtSign className="h-4 w-4" />
              E-mail
            </span>
            <span className="truncate text-right font-semibold">{patient.name.toLowerCase().replace(' ', '.')}@email.com</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-[#253044]">
            <span className="inline-flex items-center gap-2 text-[#5B6475]">
              <Phone className="h-4 w-4" />
              WhatsApp
            </span>
            <span className="font-semibold">{patient.phone}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-[#253044]">
            <span className="inline-flex items-center gap-2 text-[#5B6475]">
              <MapPin className="h-4 w-4" />
              Endereço
            </span>
            <span className="text-right font-semibold">Rua das Flores, 123</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-[#253044]">
            <span className="inline-flex items-center gap-2 text-[#5B6475]">
              <LocateFixed className="h-4 w-4" />
              CEP
            </span>
            <span className="font-semibold">01458-000</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge tone={patient.paymentStatus === 'paid' ? 'green' : 'gold'}>
            {patient.paymentStatus === 'paid' ? 'Pagamento confirmado' : 'Pagamento pendente'}
          </Badge>
          <Badge>{patient.source}</Badge>
          <Badge>{patient.submittedAt}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
