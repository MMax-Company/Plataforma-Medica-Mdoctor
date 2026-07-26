'use client';

import { Clock, Headphones, Users } from 'lucide-react';

export type SupportQueueItem = {
  id: string;
  paciente_nome: string;
  paciente_telefone?: string;
  criado_em?: string;
  status?: string;
  support_sub_status?: string;
};

function whatsappUrl(phone?: string) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const withCountry = digits.startsWith('55') ? digits : `55${digits}`;
  return `https://wa.me/${withCountry}`;
}

function minutesWaiting(items: SupportQueueItem[]) {
  if (!items.length) return '—';
  const oldest = items
    .map((item) => (item.criado_em ? new Date(item.criado_em).getTime() : Date.now()))
    .sort((a, b) => a - b)[0];
  const diff = Math.max(0, Date.now() - oldest);
  const minutes = Math.max(1, Math.ceil(diff / 60000));
  return `${String(minutes).padStart(2, '0')} min`;
}

function getApiBase() {
  return (
    (typeof window !== 'undefined' && (window as any).__NEXT_PUBLIC_API_URL__) ||
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    'http://localhost:3004'
  );
}

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('mdoctor_auth_token') : null;
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

function subStatusLabel(sub?: string): string {
  switch (sub) {
    case 'em_atendimento': return 'Em atendimento';
    case 'awaiting_patient_decision': return 'Aguardando decisão';
    default: return 'Aguardando';
  }
}

interface MedicalSupportBandProps {
  patients: SupportQueueItem[];
  onQueueRefresh?: () => void;
  /** 'lg' dá mais destaque visual (usado no Painel Administrativo) — mesmo
   * layout/lógica do Painel Médico, só maior. Default preserva o visual
   * atual do Painel Médico sem nenhuma mudança. */
  size?: 'compact' | 'lg';
}

export function MedicalSupportBand({ patients, onQueueRefresh, size = 'compact' }: MedicalSupportBandProps) {
  const visible = patients.slice(0, 10);
  const extra = Math.max(0, patients.length - 10);
  const lg = size === 'lg';

  async function handleAttend(patient: SupportQueueItem) {
    try {
      const res = await fetch(`${getApiBase()}/api/atendimentos/${patient.id}/support/start`, {
        method: 'POST',
        headers: authHeaders()
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Erro ao iniciar atendimento');
        return;
      }
    } catch {
      // best-effort
    }
    onQueueRefresh?.();
    const url = whatsappUrl(patient.paciente_telefone);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function handleFinalize(patient: SupportQueueItem) {
    try {
      const res = await fetch(`${getApiBase()}/api/atendimentos/${patient.id}/support/finalize`, {
        method: 'POST',
        headers: authHeaders()
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Erro ao finalizar atendimento');
        return;
      }
    } catch {
      // best-effort
    }
    onQueueRefresh?.();
  }

  return (
    <section
      className={`panel-support-band${lg ? ' panel-support-band--lg' : ''} flex shrink-0 items-center bg-[#EEF4FF] ${
        lg ? 'border-2 border-[#BFD0FF]' : 'border border-[#D9E6FF]'
      }`}
    >
      <div className="grid w-full grid-cols-[1.15fr_0.95fr_1.1fr] items-center gap-0">
        <div className={`flex min-w-0 items-center border-r border-[#D9E6FF] ${lg ? 'gap-4 pr-5' : 'gap-2.5 pr-4'}`}>
          <div
            className={`flex shrink-0 items-center justify-center rounded-full bg-[#D9E6FF] text-[#1A3F8F] ${lg ? 'h-14 w-14' : 'h-8 w-8'}`}
          >
            <Headphones className={lg ? 'h-7 w-7' : 'h-4 w-4'} strokeWidth={2.2} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className={`font-black leading-tight text-[#1A3F8F] ${lg ? 'text-[23px]' : 'text-[14px]'}`}>
              SUPORTE MÉDICO VIA WHATSAPP
            </h2>
            <p className={`dp-text-muted mt-0.5 leading-snug ${lg ? 'text-[14px]' : 'text-[11px]'}`}>
              Pacientes aguardando atendimento da equipe de suporte via WhatsApp.
            </p>
          </div>
        </div>

        <div className={`flex flex-col justify-center border-r border-[#D9E6FF] ${lg ? 'gap-2 px-5' : 'gap-0.5 px-4'}`}>
          <p className={`flex items-center gap-1.5 font-semibold text-[#1A2333] ${lg ? 'text-[17px]' : 'text-[12px]'}`}>
            <Users className={lg ? 'h-5 w-5 shrink-0 text-[#1A3F8F]' : 'h-3.5 w-3.5 shrink-0 text-[#1A3F8F]'} aria-hidden="true" />
            <span>
              <strong className="font-black">{patients.length}</strong> aguardando atendimento
            </span>
          </p>
          <p className={`dp-text-muted flex items-center gap-1.5 ${lg ? 'text-[14px]' : 'text-[11px]'}`}>
            <Clock className={lg ? 'h-5 w-5 shrink-0 text-[#1A3F8F]' : 'h-3.5 w-3.5 shrink-0 text-[#1A3F8F]'} aria-hidden="true" />
            Esperando há{' '}
            <span className={`font-black text-[#1A3F8F] ${lg ? 'text-[26px]' : 'text-[15px]'}`}>{minutesWaiting(patients)}</span>
          </p>
        </div>

        <div className={`flex min-w-0 flex-col items-end justify-center ${lg ? 'pl-4' : 'pl-3'}`}>
          <div className={`flex flex-wrap items-center justify-end gap-1.5 ${lg ? 'min-h-[36px]' : 'min-h-[28px]'}`}>
            {visible.length === 0 ? (
              <span className={`dp-text-subtle font-medium ${lg ? 'text-[13px]' : 'text-[11px]'}`}>Nenhum paciente na fila de suporte</span>
            ) : (
              visible.map((patient, index) => {
                const sub = patient.support_sub_status;
                const isActive = sub === 'em_atendimento';
                const isDecision = sub === 'awaiting_patient_decision';

                return (
                  <span
                    key={patient.id}
                    className="inline-flex items-center gap-0.5 rounded-[8px] border border-[#C5D8F5] bg-white px-1 py-0.5"
                    title={`${patient.paciente_nome} — ${subStatusLabel(sub)}`}
                  >
                    <button
                      type="button"
                      onClick={() => handleAttend(patient)}
                      className={`inline-flex cursor-pointer items-center justify-center rounded-[8px] font-black transition-all duration-200 ${
                        lg ? 'h-10 min-w-10 px-2.5 text-[16px]' : 'h-7 min-w-7 px-1.5 text-[12px]'
                      } ${
                        isDecision
                          ? 'bg-amber-100 text-amber-700'
                          : isActive
                            ? 'bg-green-100 text-green-700'
                            : index === 0
                              ? 'bg-[#1557FF] text-white shadow-[0_2px_8px_rgba(21,87,255,0.18)]'
                              : 'bg-[#EEF4FF] text-[#1A3F8F] hover:bg-[#1557FF] hover:text-white'
                      }`}
                      aria-label={`Atender ${patient.paciente_nome} via WhatsApp`}
                    >
                      {index + 1}
                    </button>
                    {(isActive || isDecision) && (
                      <button
                        type="button"
                        onClick={() => handleFinalize(patient)}
                        className="inline-flex h-5 cursor-pointer items-center justify-center rounded-[4px] bg-red-50 px-1 text-[9px] font-bold text-red-600 hover:bg-red-100"
                        aria-label={`Finalizar atendimento de ${patient.paciente_nome}`}
                        title="Finalizar atendimento"
                      >
                        ✓
                      </button>
                    )}
                  </span>
                );
              })
            )}
            {extra > 0 ? (
              <span
                className="inline-flex h-7 min-w-7 items-center justify-center rounded-[8px] border border-[#C5D8F5] bg-white px-1.5 text-[12px] font-bold text-[#1A3F8F]"
                title={`Mais ${extra} paciente(s) na fila`}
              >
                +{extra}
              </span>
            ) : null}
          </div>
          <p className={`dp-text-subtle mt-1 ${lg ? 'text-[11px]' : 'text-[10px]'}`}>Clique no número para abrir WhatsApp · ✓ para finalizar</p>
        </div>
      </div>
    </section>
  );
}
