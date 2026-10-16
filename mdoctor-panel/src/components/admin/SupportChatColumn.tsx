'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, MessageCircle, Paperclip, Send, Users } from 'lucide-react';
import {
  fetchAdminAtendimento,
  fetchSupportConversationDetail,
  type AdminAtendimento,
  type SupportChatMessage,
  type SupportConversation,
} from '@/services/admin.service';
import { avatarInitials } from '@/lib/patient-display';

const MAX_BADGES = 5;

function minutesWaiting(conversations: SupportConversation[]): string {
  if (!conversations.length) return '—';
  const oldest = conversations
    .map((c) => (c.last_inbound_at ? new Date(c.last_inbound_at).getTime() : Date.now()))
    .sort((a, b) => a - b)[0];
  const diff = Math.max(0, Date.now() - oldest);
  const minutes = Math.max(1, Math.ceil(diff / 60000));
  return `${String(minutes).padStart(2, '0')} min`;
}

function fmtDateTime(v?: string | null) {
  if (!v) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(v));
}

function shortAppointmentId(atendimento?: AdminAtendimento | null, fallback?: string): string {
  if (atendimento?.numero_curto) return `DP-${atendimento.numero_curto}`;
  if (fallback) return `#${fallback.slice(0, 8)}`;
  return '—';
}

interface SupportChatColumnProps {
  conversations: SupportConversation[];
}

// Coluna 3 do Painel Administrativo — "SUPORTE ADMINISTRATIVO". Cabeçalho e
// corpo próprios, NÃO reaproveitam o comportamento de MedicalSupportBand
// (que abre WhatsApp externo via wa.me) — esse componente permanece
// intocado. Consome só as 2 rotas já validadas em staging:
// GET /api/admin/support/conversations (via props, polling já é feito pela
// página) e GET /api/admin/support/conversations/:id (aqui, sob demanda, ao
// selecionar uma conversa). Campo de envio aparece, mas fica sempre
// desabilitado nesta etapa — não existe rota de envio no backend ainda
// (SUPPORT_CHAT_AGENT_SEND_ENABLED continua desligado).
export function SupportChatColumn({ conversations }: Readonly<SupportChatColumnProps>) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ conversation: SupportConversation; messages: SupportChatMessage[] } | null>(
    null,
  );
  const [patientInfo, setPatientInfo] = useState<AdminAtendimento | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [isQueueMenuOpen, setQueueMenuOpen] = useState(false);
  const queueMenuRef = useRef<HTMLDivElement>(null);

  // Seleciona automaticamente a primeira conversa da fila quando nada está
  // selecionado ainda, ou quando a conversa selecionada saiu da fila (ex.:
  // foi encerrada por outro agente).
  useEffect(() => {
    if (!conversations.length) {
      setSelectedId(null);
      return;
    }
    const stillExists = selectedId && conversations.some((c) => c.id === selectedId);
    if (!stillExists) {
      setSelectedId(conversations[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations]);

  // Carrega o detalhe da conversa aberta. Depende também de `conversations`
  // (não só de `selectedId`) para que o detalhe acompanhe o mesmo polling da
  // fila — sem isso, uma conversa aberta ficava com o histórico parado até o
  // usuário trocar de conversa manualmente. A troca real de conversa (ver
  // prevSelectedIdRef) limpa detail/patientInfo IMEDIATAMENTE antes de
  // buscar os novos dados, para nunca mostrar mensagem nova com
  // identificação do paciente anterior; já uma atualização de polling na
  // MESMA conversa é silenciosa — não limpa nem mostra "Carregando...".
  const prevSelectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setPatientInfo(null);
      prevSelectedIdRef.current = null;
      return;
    }

    const isNewSelection = prevSelectedIdRef.current !== selectedId;
    prevSelectedIdRef.current = selectedId;

    if (isNewSelection) {
      setDetail(null);
      setPatientInfo(null);
      setLoadingDetail(true);
    }

    let cancelled = false;
    fetchSupportConversationDetail(selectedId)
      .then((res) => {
        if (cancelled || !res.success) return;
        setDetail({ conversation: res.conversation, messages: res.messages });
        return fetchAdminAtendimento(res.conversation.appointment_id);
      })
      .then((res) => {
        if (cancelled || !res?.success) return;
        setPatientInfo(res.atendimento);
      })
      .catch(() => {
        if (!cancelled && isNewSelection) {
          setDetail(null);
          setPatientInfo(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, conversations]);

  // Fecha o menu "ver todas as conversas" ao clicar fora dele.
  useEffect(() => {
    if (!isQueueMenuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (queueMenuRef.current && !queueMenuRef.current.contains(e.target as Node)) {
        setQueueMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [isQueueMenuOpen]);

  const awaiting = conversations.filter((c) => c.status === 'awaiting_agent');
  const badgeSource = conversations.slice(0, MAX_BADGES);
  const extraConversations = conversations.slice(MAX_BADGES);
  const extraBadges = extraConversations.length;

  function selectConversation(id: string) {
    setSelectedId(id);
    setQueueMenuOpen(false);
  }

  return (
    <section className="admin-dashboard-chat-card flex min-w-0 flex-col overflow-clip rounded-[12px] border border-[#BEE3C8] bg-white shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
      {/* Cabeçalho — verde-claro, ícone WhatsApp, contagem + tempo de espera +
          até 5 badges vermelhos, sem esconder/comprimir as demais infos. */}
      <div className="shrink-0 border-b border-[#BEE3C8] bg-[#EAF8EF] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#CFF0DB] text-[#0B7F3C]">
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[12px] font-black tracking-[0.02em] text-[#071B3A]">
                SUPORTE ADMINISTRATIVO
              </h2>
              <p className="truncate text-[9.5px] font-semibold leading-tight text-[#3F6B4F]">
                Atendimento interno aos pacientes via chat
              </p>
            </div>
          </div>
          <div className="relative flex shrink-0 items-center gap-1" ref={queueMenuRef}>
            {badgeSource.map((c, index) => (
              <button
                key={c.id}
                type="button"
                onClick={() => selectConversation(c.id)}
                className={`flex h-5 w-5 items-center justify-center rounded-[5px] text-[10px] font-black text-white transition-colors ${
                  c.id === selectedId ? 'bg-[#B91C2B] ring-2 ring-[#B91C2B]/30' : 'bg-[#DC2A3B] hover:bg-[#B91C2B]'
                }`}
                aria-label={`Abrir conversa ${index + 1}`}
              >
                {index + 1}
              </button>
            ))}
            {extraBadges > 0 && (
              <button
                type="button"
                onClick={() => setQueueMenuOpen((open) => !open)}
                title="Ver todas as conversas na fila"
                aria-label={`Ver mais ${extraBadges} conversa(s) na fila`}
                aria-expanded={isQueueMenuOpen}
                className="flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-[5px] bg-[#0B7F3C] px-1 text-[9px] font-black text-white hover:bg-[#09632F]"
              >
                +{extraBadges}
                <ChevronDown className="h-2.5 w-2.5" aria-hidden="true" />
              </button>
            )}

            {isQueueMenuOpen && extraConversations.length > 0 && (
              <div className="absolute right-0 top-full z-10 mt-1 max-h-56 w-52 overflow-y-auto rounded-[10px] border border-[#BEE3C8] bg-white py-1 shadow-[0_8px_20px_rgba(15,23,42,0.12)]">
                <p className="px-2.5 pb-1 text-[9px] font-black uppercase tracking-wide text-[#5B6475]">
                  Demais conversas na fila
                </p>
                {extraConversations.map((c, index) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => selectConversation(c.id)}
                    className={`block w-full px-2.5 py-1.5 text-left text-[10.5px] font-semibold hover:bg-[#EAF8EF] ${
                      c.id === selectedId ? 'bg-[#EAF8EF] text-[#0B7F3C]' : 'text-[#1A2333]'
                    }`}
                  >
                    {MAX_BADGES + index + 1}. Conversa {c.id.slice(0, 8)} · {fmtDateTime(c.last_message_at)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-1.5 flex items-center gap-3 text-[10.5px] font-semibold text-[#1A2333]">
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3 text-[#0B7F3C]" aria-hidden="true" />
            <strong className="font-black">{awaiting.length}</strong> aguardando atendimento
          </span>
          <span className="text-[#3F6B4F]">
            Esperando há <strong className="font-black">{minutesWaiting(awaiting)}</strong>
          </span>
        </div>
      </div>

      {/* Corpo — paciente + histórico, altura flexível dentro do total maior
          garantido pela classe admin-dashboard-chat-card (ver globals.css). */}
      {!detail ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-[11px] font-semibold text-[#5B6475]">
          {loadingDetail ? 'Carregando conversa...' : 'Nenhum atendimento aguardando no suporte administrativo.'}
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#EDF2F7] px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0F1D38] text-[9px] font-bold text-white"
                aria-hidden="true"
              >
                {avatarInitials(patientInfo?.paciente_nome || '—')}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[12px] font-black text-[#071B3A]">
                  {shortAppointmentId(patientInfo, detail.conversation.appointment_id)}{' '}
                  {patientInfo?.paciente_nome || ''}
                </p>
                <p className="truncate text-[9.5px] text-[#5B6475]">
                  Última atividade: {fmtDateTime(detail.conversation.last_message_at)}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push(`/admin/paciente/${detail.conversation.appointment_id}`)}
              className="shrink-0 rounded-[7px] border border-[#1557FF] px-2 py-1 text-[10px] font-bold text-[#1557FF] hover:bg-[#EEF4FF]"
            >
              Ver dados
            </button>
          </div>

          <div className="admin-dashboard-chat-card__history min-h-0 flex-1 overflow-y-auto px-3 py-2">
            {detail.messages.length === 0 ? (
              <p className="p-2 text-center text-[10.5px] text-[#94A3B8]">Nenhuma mensagem ainda.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {detail.messages.map((m) => {
                  const outbound = m.direction === 'outbound';
                  return (
                    <div key={m.id} className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[80%] rounded-[10px] px-2.5 py-1.5 text-[11px] leading-snug ${
                          outbound ? 'bg-[#DCF4E3] text-[#0B3B22]' : 'bg-[#F1F5F9] text-[#1A2333]'
                        }`}
                      >
                        <p>{m.body}</p>
                        <p className="mt-0.5 text-right text-[8.5px] text-[#5B6475]">{fmtDateTime(m.created_at)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Rodapé — visível, porém desabilitado: não existe rota de envio real
          no backend nesta etapa (sem envio real, por decisão explícita). */}
      <div className="sticky bottom-0 z-20 flex shrink-0 items-center gap-1.5 border-t border-[#EDF2F7] bg-white px-2.5 py-2 shadow-[0_-4px_10px_rgba(15,23,42,0.04)]">
        <button
          type="button"
          disabled
          title="Envio desabilitado nesta etapa"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#94A3B8] disabled:cursor-not-allowed"
        >
          <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <input
          type="text"
          disabled
          placeholder="Envio desabilitado nesta etapa"
          title="Envio desabilitado nesta etapa"
          className="h-8 min-w-0 flex-1 rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-3 text-[11px] text-[#5B6475] placeholder:text-[#94A3B8] disabled:cursor-not-allowed"
        />
        <button
          type="button"
          disabled
          title="Envio desabilitado nesta etapa"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#CBD5E1] text-white disabled:cursor-not-allowed"
        >
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
