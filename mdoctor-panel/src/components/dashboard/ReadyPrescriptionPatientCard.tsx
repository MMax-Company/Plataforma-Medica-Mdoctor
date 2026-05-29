'use client';

import { Loader2, Mail, MessageCircle, Smartphone } from 'lucide-react';
import { OperationalPatientCardFrame } from '@/components/dashboard/OperationalPatientCardFrame';
import { Button } from '@/components/ui/button';
import type { DeliveryChannel, Patient } from '@/types/panel';

interface ReadyPrescriptionPatientCardProps {
  patient: Patient;
  sentChannels: DeliveryChannel[];
  sendingChannel: DeliveryChannel | null;
  feedbackMessage?: string | null;
  onSend: (patientId: string, channel: DeliveryChannel) => void;
}

const channelLabels: Record<DeliveryChannel, string> = {
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  sms: 'SMS',
};

export function ReadyPrescriptionPatientCard({
  patient,
  sentChannels,
  sendingChannel,
  feedbackMessage,
  onSend,
}: ReadyPrescriptionPatientCardProps) {
  const isBusy = sendingChannel !== null;
  const whatsappSent = sentChannels.includes('whatsapp');
  const emailSent = sentChannels.includes('email');
  const smsSent = sentChannels.includes('sms');

  return (
    <OperationalPatientCardFrame
      patient={patient}
      statusLabel="Receita validada"
      statusClassName="bg-[#EAFBF1] text-[#0B7F3C]"
    >
      {feedbackMessage ? (
        <p
          className={`rounded-md border px-3 py-2 text-xs font-semibold ${
            feedbackMessage.toLowerCase().includes('falha') ||
            feedbackMessage.toLowerCase().includes('não foi') ||
            feedbackMessage.toLowerCase().includes('nao foi')
              ? 'border-[#FFD1D1] bg-[#FFECEC] text-[#B91C1C]'
              : 'border-[#B8E8CC] bg-[#EAFBF1] text-[#0B7F3C]'
          }`}
        >
          {feedbackMessage}
        </p>
      ) : null}

      <Button
        type="button"
        className="h-10 w-full bg-[#0BA84F] text-white hover:bg-[#099245] disabled:opacity-60"
        disabled={isBusy || whatsappSent}
        onClick={() => onSend(patient.id, 'whatsapp')}
      >
        {sendingChannel === 'whatsapp' ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
        )}
        {whatsappSent ? 'WhatsApp enviado' : 'Enviar por WhatsApp'}
      </Button>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-10 px-2 text-xs disabled:opacity-60"
          disabled={isBusy || emailSent}
          onClick={() => onSend(patient.id, 'email')}
        >
          {sendingChannel === 'email' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Mail className="h-4 w-4" aria-hidden="true" />
          )}
          {emailSent ? 'E-mail enviado' : 'E-mail'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 px-2 text-xs disabled:opacity-60"
          disabled={isBusy || smsSent}
          onClick={() => onSend(patient.id, 'sms')}
        >
          {sendingChannel === 'sms' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Smartphone className="h-4 w-4" aria-hidden="true" />
          )}
          {smsSent ? 'SMS enviado' : 'SMS'}
        </Button>
      </div>

      {sentChannels.length > 0 ? (
        <p className="text-center text-[11px] font-medium text-[#5B6475]">
          Enviado: {sentChannels.map((channel) => channelLabels[channel]).join(' · ')}
        </p>
      ) : null}
    </OperationalPatientCardFrame>
  );
}
