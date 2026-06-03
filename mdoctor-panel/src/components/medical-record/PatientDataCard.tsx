import {
  AtSign,
  CalendarDays,
  LocateFixed,
  MapPin,
  MessageCircle,
  Phone,
  UserRound,
} from 'lucide-react';
import { formatQueuePatientId, patientInitials, whatsappContactUrl } from '@/lib/patient-display';
import type { Patient } from '@/types/panel';

interface PatientDataCardProps {
  patient: Patient;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function PatientDataCard({ patient }: PatientDataCardProps) {
  const initials = patientInitials(patient.name);
  const birthDateRaw = patient.birthDate || '';
  const birthDate = /^\d{4}-\d{2}-\d{2}$/.test(birthDateRaw)
    ? (() => {
        const [y, m, d] = birthDateRaw.split('-');
        return `${d}/${m}/${y}`;
      })()
    : birthDateRaw || 'Não informado';
  const prontuarioNum = String(patient.clinicalData?.prontuario_display || formatQueuePatientId(patient.id));
  const cpf = patient.cpf || 'Não informado';
  const email = patient.email || 'Não informado';
  const address = patient.address || 'Não informado';
  const cep = String(patient.clinicalData?.cep || patient.clinicalData?.patient_cep || 'Não informado');
  const whatsappUrl = whatsappContactUrl(patient.phone);
  const ageLabel = patient.age > 0 ? `${patient.age} anos` : '—';

  const rows = [
    { icon: CalendarDays, label: 'Data de nascimento', value: birthDate },
    { icon: UserRound, label: 'CPF', value: cpf },
    { icon: AtSign, label: 'E-mail', value: email, isMail: isEmail(email) },
    { icon: Phone, label: 'WhatsApp', value: patient.phone || 'Não informado' },
    { icon: MapPin, label: 'Endereço', value: address },
    { icon: LocateFixed, label: 'CEP', value: cep },
  ];

  return (
    <section className="prontuario-patient-card">
      <div className="prontuario-patient-card__head">
        <h2 className="prontuario-patient-card__title">DADOS DO PACIENTE</h2>
      </div>

      <div className="prontuario-patient-card__body">
        <div className="flex items-start gap-3">
          <div className="prontuario-patient-card__avatar">{initials}</div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="prontuario-patient-card__name">{patient.name}</p>
              <span className="prontuario-patient-card__age">{ageLabel}</span>
            </div>
            <p className="prontuario-patient-card__record">Prontuário: #{prontuarioNum}</p>
            {whatsappUrl ? (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="prontuario-patient-card__whatsapp"
              >
                <MessageCircle className="h-4 w-4 text-[#25D366]" aria-hidden="true" />
                Contato via WhatsApp
              </a>
            ) : (
              <p className="prontuario-patient-card__whatsapp">
                <MessageCircle className="h-4 w-4 text-[#25D366]" aria-hidden="true" />
                Contato via WhatsApp
              </p>
            )}
          </div>
        </div>

        <div className="prontuario-patient-card__rows">
          {rows.map(({ icon: Icon, label, value, isMail }) => (
            <div key={label} className="prontuario-patient-card__row">
              <span className="prontuario-patient-card__label">
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {label}
              </span>
              {isMail ? (
                <a href={`mailto:${value}`} className="prontuario-patient-card__value prontuario-patient-card__value--link">
                  {value}
                </a>
              ) : (
                <span className="prontuario-patient-card__value">{value}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
