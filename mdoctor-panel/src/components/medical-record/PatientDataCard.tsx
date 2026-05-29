import { AtSign, CalendarDays, LocateFixed, MapPin, MessageCircle, Phone, UserRound } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { formatQueuePatientId, patientInitials, whatsappContactUrl } from '@/lib/patient-display';
import type { Patient } from '@/types/panel';

interface PatientDataCardProps {
  patient: Patient;
}

export function PatientDataCard({ patient }: PatientDataCardProps) {
  const initials = patientInitials(patient.name);
  const birthDate = patient.birthDate || 'Não informado';
  const cpf = patient.cpf || 'Não informado';
  const email = patient.email || 'Não informado';
  const address = patient.address || 'Não informado';
  const cep = String(patient.clinicalData?.cep || patient.clinicalData?.patient_cep || 'Não informado');
  const whatsappUrl = whatsappContactUrl(patient.phone);
  const ageLabel = patient.age > 0 ? `${patient.age} anos` : 'Não informado';

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-bold text-[#1E1E1E]">DADOS DO PACIENTE</h2>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl border border-[#E5EAF2] bg-[#F8FAFC] p-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#EEF4FF] text-lg font-bold text-[#1557FF]">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-xl font-bold text-[#1E1E1E]">{patient.name}</p>
            <p className="mt-1 text-sm text-[#5B6475]">{ageLabel}</p>
            <p className="mt-1 font-mono text-sm font-semibold text-[#4A67A1]">#{formatQueuePatientId(patient.id)}</p>
          </div>
        </div>

        {whatsappUrl ? (
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[14px] bg-[#25D366] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1DA851]"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            WhatsApp
          </a>
        ) : null}

        <div className="space-y-3 rounded-xl border border-[#E5EAF2] bg-white p-3 text-sm">
          <div className="flex items-center justify-between gap-2 text-[#253044]">
            <span className="inline-flex items-center gap-2 text-[#5B6475]">
              <CalendarDays className="h-4 w-4" />
              Data de nascimento
            </span>
            <span className="font-semibold">{birthDate}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-[#253044]">
            <span className="inline-flex items-center gap-2 text-[#5B6475]">
              <UserRound className="h-4 w-4" />
              CPF
            </span>
            <span className="font-semibold">{cpf}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-[#253044]">
            <span className="inline-flex items-center gap-2 text-[#5B6475]">
              <AtSign className="h-4 w-4" />
              E-mail
            </span>
            <span className="truncate text-right font-semibold">{email}</span>
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
            <span className="text-right font-semibold">{address}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-[#253044]">
            <span className="inline-flex items-center gap-2 text-[#5B6475]">
              <LocateFixed className="h-4 w-4" />
              CEP
            </span>
            <span className="font-semibold">{cep}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
