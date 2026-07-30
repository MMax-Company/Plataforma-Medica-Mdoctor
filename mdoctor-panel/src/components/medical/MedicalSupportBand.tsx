'use client';

import { CheckCircle2, Clock, Headphones, Stethoscope, Undo2, Users } from 'lucide-react';

export type SupportQueueItem = {
  /** Identificador próprio do ticket de suporte (support_tickets.id). */
  id: string;
  ticket_id?: string;
  /** Atendimento clínico relacionado; nunca é usado como identificador do ticket. */
  atendimento_id?: string | null;
  patient_id?: string | null;
  paciente_nome: string;
  paciente_telefone?: string;
  criado_em?: string;
  status?: string;
  support_sub_status?: string;
  /** Só preenchido no modo 'medical_support' — motivo registrado pelo suporte
   * administrativo ao encaminhar (ver admin.routes.js forward-to-doctor). */
  medical_support_reason?: string | null;
  /** Ciclo administrativo → médico → administrativo do próprio ticket de
   * Suporte Geral (modos 'whatsapp_support' e 'ticket_medical' — ver
   * whatsapp-support.service.js forward/answer/close). Nunca confundir com
   * medical_support_reason acima, que pertence ao fluxo de atendimentos. */
  medical_forward_reason?: string | null;
  medical_response?: string | null;
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
    case 'forwarded_to_doctor': return 'Aguardando resposta médica';
    case 'answered_by_doctor': return 'Resposta médica recebida';
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
  /**
   * 'whatsapp_support' (default) — Suporte Geral, fila de tickets criados
   * antes do chatbot (Atender abre WhatsApp + inicia; ✓ finaliza e devolve a
   * decisão ao paciente). Usado no Painel Administrativo.
   *
   * 'medical_support' — Suporte Médico: atendimentos clínicos reais
   * encaminhados pelo suporte administrativo para esclarecimento pontual.
   * Usado no Painel Médico — nunca mistura com Suporte Geral (regra de
   * negócio: tickets de Suporte Geral nunca vão ao médico). Cada item abre o
   * prontuário em modo consulta antes de decidir; ações são "Dúvida
   * resolvida" e "Retornar ao Suporte Administrativo".
   *
   * 'ticket_medical' — ciclo administrativo → médico → administrativo do
   * próprio ticket de Suporte Geral (não é atendimento clínico, não abre
   * prontuário). Usado no Painel Médico junto de 'medical_support', mas
   * sobre uma fila e um endpoint totalmente separados
   * (/support-queue/medical, /:id/support/answer). Ação é só "Responder".
   */
  mode?: 'whatsapp_support' | 'medical_support' | 'ticket_medical';
  /** Obrigatório no modo 'medical_support' — abre o prontuário (consultMode). */
  onOpenProntuario?: (id: string) => void;
}

export function MedicalSupportBand({
  patients,
  onQueueRefresh,
  size = 'compact',
  mode = 'whatsapp_support',
  onOpenProntuario,
}: MedicalSupportBandProps) {
  const visible = patients.slice(0, 10);
  const extra = Math.max(0, patients.length - 10);
  const lg = size === 'lg';
  const isMedicalSupport = mode === 'medical_support';
  const isTicketMedical = mode === 'ticket_medical';

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

  async function handleResolve(patient: SupportQueueItem) {
    try {
      const res = await fetch(`${getApiBase()}/api/atendimentos/${patient.id}/medical-support/resolve`, {
        method: 'POST',
        headers: authHeaders()
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Erro ao encerrar dúvida médica');
        return;
      }
    } catch {
      // best-effort
    }
    onQueueRefresh?.();
  }

  async function handleReturn(patient: SupportQueueItem) {
    try {
      const res = await fetch(`${getApiBase()}/api/atendimentos/${patient.id}/medical-support/return`, {
        method: 'POST',
        headers: authHeaders()
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Erro ao retornar ao suporte administrativo');
        return;
      }
    } catch {
      // best-effort
    }
    onQueueRefresh?.();
  }

  async function handleForwardToDoctor(patient: SupportQueueItem) {
    const motivo = window.prompt('Motivo do encaminhamento ao médico:');
    if (!motivo || !motivo.trim()) return;
    try {
      const res = await fetch(`${getApiBase()}/api/atendimentos/${patient.id}/support/forward-to-doctor`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ motivo: motivo.trim() })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Erro ao encaminhar ao médico');
        return;
      }
    } catch {
      // best-effort
    }
    onQueueRefresh?.();
  }

  async function handleAdminCloseTicket(patient: SupportQueueItem) {
    try {
      const res = await fetch(`${getApiBase()}/api/atendimentos/${patient.id}/support/close`, {
        method: 'POST',
        headers: authHeaders()
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Erro ao encerrar ticket');
        return;
      }
    } catch {
      // best-effort
    }
    onQueueRefresh?.();
  }

  async function handleAnswerTicket(patient: SupportQueueItem) {
    const resposta = window.prompt('Resposta médica para o suporte administrativo:');
    if (!resposta || !resposta.trim()) return;
    try {
      const res = await fetch(`${getApiBase()}/api/atendimentos/${patient.id}/support/answer`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ resposta: resposta.trim() })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Erro ao responder ticket');
        return;
      }
    } catch {
      // best-effort
    }
    onQueueRefresh?.();
  }

  const theme = isMedicalSupport || isTicketMedical
    ? {
        section: 'border-[#F3D9BF] bg-[#FFF7ED]',
        divider: 'border-[#D9E6FF] border-r-[#F3D9BF]',
        iconBg: 'bg-[#FDE7CE] text-[#9A5B12]',
        title: 'text-[#9A5B12]',
        chip: 'border-[#F0CBA0]',
        Icon: Stethoscope,
      }
    : {
        section: 'border-[#D9E6FF] bg-[#EEF4FF]',
        divider: 'border-[#D9E6FF]',
        iconBg: 'bg-[#D9E6FF] text-[#1A3F8F]',
        title: 'text-[#1A3F8F]',
        chip: 'border-[#C5D8F5]',
        Icon: Headphones,
      };

  const copy = isTicketMedical
    ? {
        title: 'TICKETS DE SUPORTE ENCAMINHADOS',
        subtitle: 'Tickets de Suporte Geral encaminhados pelo administrativo para resposta médica pontual.',
        countLabel: 'aguardando resposta médica',
        emptyLabel: 'Nenhum ticket encaminhado',
        footerHint: 'Clique no fone para abrir WhatsApp · Responder envia a decisão médica ao suporte',
      }
    : isMedicalSupport
      ? {
          title: 'DÚVIDAS ENCAMINHADAS PELO SUPORTE',
          subtitle: 'Atendimentos clínicos encaminhados pelo suporte para esclarecimento médico pontual.',
          countLabel: 'aguardando resposta médica',
          emptyLabel: 'Nenhuma dúvida encaminhada',
          footerHint: 'Ver jornada abre o prontuário (somente leitura) · ✓ resolve · ↩ retorna ao suporte',
        }
      : {
          title: 'SUPORTE MÉDICO VIA WHATSAPP',
          subtitle: 'Pacientes aguardando atendimento da equipe de suporte via WhatsApp.',
          countLabel: 'aguardando atendimento',
          emptyLabel: 'Nenhum paciente na fila de suporte',
          footerHint: 'Clique no número para abrir WhatsApp · ✓ finaliza · 🩺 encaminha ao médico',
        };

  return (
    <section
      className={`panel-support-band${lg ? ' panel-support-band--lg' : ''} flex shrink-0 items-center ${theme.section} ${
        lg ? 'border-2' : 'border'
      }`}
    >
      <div className="grid w-full grid-cols-[1.15fr_0.95fr_1.1fr] items-center gap-0">
        <div className={`flex min-w-0 items-center border-r ${theme.divider} ${lg ? 'gap-4 pr-5' : 'gap-2.5 pr-4'}`}>
          <div
            className={`flex shrink-0 items-center justify-center rounded-full ${theme.iconBg} ${lg ? 'h-14 w-14' : 'h-8 w-8'}`}
          >
            <theme.Icon className={lg ? 'h-7 w-7' : 'h-4 w-4'} strokeWidth={2.2} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className={`flex items-center gap-2 font-black leading-tight ${theme.title} ${lg ? 'text-[23px]' : 'text-[14px]'}`}>
              {copy.title}
              {(isMedicalSupport || isTicketMedical) && patients.length > 0 && (
                <span
                  className="dp-col-count-alert inline-flex items-center justify-center"
                  title={`${patients.length} pendência(s) nova(s)`}
                >
                  {patients.length}
                </span>
              )}
            </h2>
            <p className={`dp-text-muted mt-0.5 leading-snug ${lg ? 'text-[14px]' : 'text-[11px]'}`}>
              {copy.subtitle}
            </p>
          </div>
        </div>

        <div className={`flex flex-col justify-center border-r ${theme.divider} ${lg ? 'gap-2 px-5' : 'gap-0.5 px-4'}`}>
          <p className={`flex items-center gap-1.5 font-semibold text-[#1A2333] ${lg ? 'text-[17px]' : 'text-[12px]'}`}>
            <Users className={`${lg ? 'h-5 w-5' : 'h-3.5 w-3.5'} shrink-0 ${theme.title}`} aria-hidden="true" />
            <span>
              <strong className="font-black">{patients.length}</strong> {copy.countLabel}
            </span>
          </p>
          <p className={`dp-text-muted flex items-center gap-1.5 ${lg ? 'text-[14px]' : 'text-[11px]'}`}>
            <Clock className={`${lg ? 'h-5 w-5' : 'h-3.5 w-3.5'} shrink-0 ${theme.title}`} aria-hidden="true" />
            Esperando há{' '}
            <span className={`font-black ${theme.title} ${lg ? 'text-[26px]' : 'text-[15px]'}`}>{minutesWaiting(patients)}</span>
          </p>
        </div>

        <div className={`flex min-w-0 flex-col items-end justify-center ${lg ? 'pl-4' : 'pl-3'}`}>
          <div className={`flex flex-wrap items-center justify-end gap-1.5 ${lg ? 'min-h-[36px]' : 'min-h-[28px]'}`}>
            {visible.length === 0 ? (
              <span className={`dp-text-subtle font-medium ${lg ? 'text-[13px]' : 'text-[11px]'}`}>
                {copy.emptyLabel}
              </span>
            ) : isTicketMedical ? (
              visible.map((patient) => {
                const url = whatsappUrl(patient.paciente_telefone);
                return (
                  <span
                    key={patient.id}
                    className={`inline-flex items-center gap-0.5 rounded-[8px] border ${theme.chip} bg-white px-1 py-0.5`}
                    title={patient.medical_forward_reason || patient.paciente_nome}
                  >
                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full ${theme.iconBg} ${
                          lg ? 'h-8 w-8' : 'h-6 w-6'
                        }`}
                        aria-label={`Abrir WhatsApp do paciente — ${patient.paciente_nome}`}
                        title="Abrir WhatsApp do paciente"
                      >
                        <Headphones className={lg ? 'h-4 w-4' : 'h-3 w-3'} aria-hidden="true" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => handleAnswerTicket(patient)}
                      className={`inline-flex cursor-pointer items-center justify-center rounded-[8px] font-black text-[#9A5B12] hover:bg-[#FBD9AE] ${
                        lg ? 'h-10 px-3 text-[13px]' : 'h-7 px-2 text-[11px]'
                      } bg-[#FDE7CE]`}
                      aria-label={`Responder ticket de ${patient.paciente_nome}`}
                    >
                      Responder
                    </button>
                  </span>
                );
              })
            ) : isMedicalSupport ? (
              visible.map((patient) => (
                <span
                  key={patient.id}
                  className={`inline-flex items-center gap-0.5 rounded-[8px] border ${theme.chip} bg-white px-1 py-0.5`}
                  title={patient.medical_support_reason || patient.paciente_nome}
                >
                  <button
                    type="button"
                    onClick={() => onOpenProntuario?.(patient.id)}
                    className={`inline-flex cursor-pointer items-center justify-center rounded-[8px] font-black text-[#9A5B12] hover:bg-[#FBD9AE] ${
                      lg ? 'h-10 px-3 text-[13px]' : 'h-7 px-2 text-[11px]'
                    } bg-[#FDE7CE]`}
                    aria-label={`Ver jornada de ${patient.paciente_nome}`}
                  >
                    Ver jornada
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResolve(patient)}
                    className="inline-flex h-5 cursor-pointer items-center justify-center rounded-[4px] bg-emerald-50 px-1 text-emerald-700 hover:bg-emerald-100"
                    aria-label={`Dúvida resolvida — ${patient.paciente_nome}`}
                    title="Dúvida resolvida"
                  >
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReturn(patient)}
                    className="inline-flex h-5 cursor-pointer items-center justify-center rounded-[4px] bg-slate-100 px-1 text-slate-600 hover:bg-slate-200"
                    aria-label={`Retornar ao suporte administrativo — ${patient.paciente_nome}`}
                    title="Retornar ao suporte administrativo"
                  >
                    <Undo2 className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              ))
            ) : (
              visible.map((patient, index) => {
                const sub = patient.support_sub_status;
                const isActive = sub === 'em_atendimento';
                const isDecision = sub === 'awaiting_patient_decision';
                const isForwarded = sub === 'forwarded_to_doctor';
                const isAnswered = sub === 'answered_by_doctor';
                const canForwardToDoctor = !isForwarded && !isAnswered;
                const tooltip = [
                  `${patient.paciente_nome} — ${subStatusLabel(sub)}`,
                  patient.medical_forward_reason ? `Motivo: ${patient.medical_forward_reason}` : null,
                  patient.medical_response ? `Resposta médica: ${patient.medical_response}` : null,
                ]
                  .filter(Boolean)
                  .join(' | ');

                return (
                  <span
                    key={patient.id}
                    className="inline-flex items-center gap-0.5 rounded-[8px] border border-[#C5D8F5] bg-white px-1 py-0.5"
                    title={tooltip}
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
                    {canForwardToDoctor && (
                      <button
                        type="button"
                        onClick={() => handleForwardToDoctor(patient)}
                        className="inline-flex h-5 cursor-pointer items-center justify-center rounded-[4px] bg-orange-50 px-1 text-orange-700 hover:bg-orange-100"
                        aria-label={`Encaminhar ao médico — ${patient.paciente_nome}`}
                        title="Encaminhar ao médico"
                      >
                        <Stethoscope className="h-3 w-3" aria-hidden="true" />
                      </button>
                    )}
                    {isAnswered && (
                      <button
                        type="button"
                        onClick={() => handleAdminCloseTicket(patient)}
                        className="inline-flex h-5 cursor-pointer items-center justify-center rounded-[4px] bg-emerald-50 px-1 text-emerald-700 hover:bg-emerald-100"
                        aria-label={`Encerrar ticket — ${patient.paciente_nome}`}
                        title="Encerrar ticket (resposta médica recebida)"
                      >
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                      </button>
                    )}
                  </span>
                );
              })
            )}
            {extra > 0 ? (
              <span
                className={`inline-flex h-7 min-w-7 items-center justify-center rounded-[8px] border ${theme.chip} bg-white px-1.5 text-[12px] font-bold ${theme.title}`}
                title={`Mais ${extra} paciente(s) na fila`}
              >
                +{extra}
              </span>
            ) : null}
          </div>
          <p className={`dp-text-subtle mt-1 ${lg ? 'text-[11px]' : 'text-[10px]'}`}>
            {copy.footerHint}
          </p>
        </div>
      </div>
    </section>
  );
}
