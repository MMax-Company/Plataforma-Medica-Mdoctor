'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, MessageCircle, Paperclip, Send, Users } from 'lucide-react';
import {
  claimSupportConversation,
  closeSupportConversation,
  fetchAdminAtendimento,
  fetchSupportConversationDetail,
  heartbeatSupportConversation,
  releaseSupportConversation,
  sendSupportChatMessage,
  type AdminAtendimento,
  type SupportChatMessage,
  type SupportConversation,
  type SupportMessagingWindowStatus,
} from '@/services/admin.service';

// Bem abaixo do lease do lock (DEFAULT_LOCK_LEASE_MS = 2 min no backend) —
// garante várias tentativas de renovação dentro da janela mesmo se uma
// chamada individual falhar por uma instabilidade de rede pontual.
const HEARTBEAT_INTERVAL_MS = 45000;
import { ApiError } from '@/services/api';
import { avatarInitials } from '@/lib/patient-display';

type LockOwnership = 'checking' | 'owned' | 'other' | 'released' | null;

const STATUS_BADGES: Record<SupportConversation['status'], { label: string; className: string }> = {
  open: { label: 'Aberta', className: 'bg-[#EEF2FF] text-[#3730A3]' },
  awaiting_agent: { label: 'Aguardando atendimento', className: 'bg-[#FEF2F2] text-[#B91C2B]' },
  awaiting_patient: { label: 'Aguardando paciente', className: 'bg-[#EAF8EF] text-[#0B7F3C]' },
  closed: { label: 'Encerrada', className: 'bg-[#F1F5F9] text-[#5B6475]' },
};

function sendErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 503) return 'Envio ainda não habilitado nesta etapa.';
    if (error.status === 404) return 'Conversa não encontrada.';
    if (error.status === 422) return 'Paciente sem telefone cadastrado para envio.';
    if (error.status === 502) return 'Falha ao enviar pelo WhatsApp. Tente novamente.';
    if (error.status === 409) return 'Não foi possível enviar agora (posse ou janela de 24h). Reabra a conversa e tente de novo.';
  }
  return 'Falha ao enviar a mensagem.';
}

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
// intocado. Consome GET /api/admin/support/conversations (via props,
// polling já é feito pela página), GET /api/admin/support/conversations/:id
// (aqui, sob demanda, ao selecionar uma conversa), claim/release (posse do
// lock antes de habilitar o composer) e POST .../messages (envio humano
// real). Toda validação de posse/janela de 24h/flag é feita no servidor —
// este componente só reflete o resultado (sucesso/erro) no composer, nunca
// decide localmente se o envio é permitido.
export function SupportChatColumn({ conversations }: Readonly<SupportChatColumnProps>) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    conversation: SupportConversation;
    messages: SupportChatMessage[];
    windowStatus: SupportMessagingWindowStatus | null;
    agentSendEnabled: boolean;
  } | null>(null);
  const [patientInfo, setPatientInfo] = useState<AdminAtendimento | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [isQueueMenuOpen, setQueueMenuOpen] = useState(false);
  const queueMenuRef = useRef<HTMLDivElement>(null);
  const [lockOwnership, setLockOwnership] = useState<LockOwnership>(null);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const ownedConversationIdRef = useRef<string | null>(null);
  const currentSelectedIdRef = useRef<string | null>(null);
  // client_message_id do rascunho atual — gerado uma vez por intenção de
  // envio e MANTIDO entre tentativas de "Tentar novamente" do mesmo texto.
  // Se gerasse um ID novo a cada clique, um timeout/falha de rede ambíguo
  // (o backend pode ter enviado e persistido mesmo sem a resposta chegar)
  // faria o reenvio burlar a idempotência do servidor e mandar a mesma
  // mensagem duas vezes ao paciente. Só vira null (novo ID na próxima
  // tentativa) depois de um envio confirmado ou quando o atendente edita o
  // texto — nesse caso é, de fato, um conteúdo novo.
  const draftClientMessageIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentSelectedIdRef.current = selectedId;
  }, [selectedId]);

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
      setLockOwnership('checking');
      setMessageText('');
      setSendError(null);
      draftClientMessageIdRef.current = null;
    }

    let cancelled = false;
    fetchSupportConversationDetail(selectedId)
      .then((res) => {
        if (cancelled || !res.success) return;
        setDetail({
          conversation: res.conversation,
          messages: res.messages,
          windowStatus: res.windowStatus,
          agentSendEnabled: res.agentSendEnabled,
        });
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

  // Posse (claim) do lock antes de permitir envio — nunca deduzida no
  // cliente: toda tentativa de claim/release passa pelo servidor
  // (validateClaim no store). Reivindica só na troca de conversa
  // selecionada (não a cada atualização de polling), e libera a conversa
  // anterior se este agente era o dono antes de trocar/desmontar — nunca
  // libera lock de outro agente.
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const claimedId = selectedId;

    claimSupportConversation(claimedId)
      .then((res) => {
        if (!res.success) return;
        if (cancelled) {
          // Seleção já mudou antes do claim responder — este efeito não vai
          // rodar seu próprio cleanup de novo, então libera aqui mesmo para
          // nunca deixar um lock preso até o lease (2 min) expirar sozinho.
          releaseSupportConversation(claimedId).catch(() => {});
          return;
        }
        ownedConversationIdRef.current = claimedId;
        setLockOwnership('owned');
        setDetail((prev) => (prev && prev.conversation.id === claimedId ? { ...prev, conversation: res.conversation } : prev));
      })
      .catch((error) => {
        if (cancelled) return;
        setLockOwnership('other');
        if (error instanceof ApiError && error.status !== 409) {
          setSendError('Não foi possível verificar a posse desta conversa.');
        }
      });

    return () => {
      cancelled = true;
      if (ownedConversationIdRef.current === claimedId) {
        ownedConversationIdRef.current = null;
        releaseSupportConversation(claimedId).catch(() => {
          // best-effort — o lock expira sozinho (lease) mesmo se a liberação falhar
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Renovação periódica do lock (heartbeat) enquanto esta conversa está
  // owned — sem isso, o lease padrão de 2 minutos expiraria silenciosamente
  // no meio de um atendimento mais longo: o composer continuaria mostrando
  // "owned" mas todo envio seria rejeitado como lock_expired. Qualquer falha
  // de heartbeat tira o estado local de 'owned' (nunca finge posse que pode
  // já ter sido perdida) e expõe o botão "Reivindicar".
  useEffect(() => {
    if (!selectedId || lockOwnership !== 'owned') return;
    const id = selectedId;
    const interval = setInterval(() => {
      heartbeatSupportConversation(id).catch(() => {
        if (currentSelectedIdRef.current !== id) return;
        if (ownedConversationIdRef.current === id) ownedConversationIdRef.current = null;
        setLockOwnership('other');
      });
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [selectedId, lockOwnership]);

  function handleMessageTextChange(value: string) {
    setMessageText(value);
    draftClientMessageIdRef.current = null;
  }

  async function handleSendMessage() {
    const text = messageText.trim();
    if (!text || !selectedId || sending) return;

    setSending(true);
    setSendError(null);
    if (!draftClientMessageIdRef.current) {
      draftClientMessageIdRef.current =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `client-${Date.now()}-${Math.random()}`;
    }
    const clientMessageId = draftClientMessageIdRef.current;

    try {
      const res = await sendSupportChatMessage(selectedId, text, clientMessageId);
      draftClientMessageIdRef.current = null;
      setMessageText('');
      setDetail((prev) => {
        if (!prev || prev.conversation.id !== selectedId) return prev;
        const alreadyPresent = prev.messages.some((m) => m.id === res.message.id);
        return {
          ...prev,
          conversation: res.conversation,
          messages: alreadyPresent ? prev.messages : [...prev.messages, res.message],
        };
      });
    } catch (error) {
      // Mantém draftClientMessageIdRef intacto — o próximo clique em
      // "Tentar novamente" reusa o MESMO client_message_id de propósito.
      setSendError(sendErrorMessage(error));
    } finally {
      setSending(false);
    }
  }

  // Reivindicação manual (botão "Reivindicar"): usada quando este agente
  // liberou a conversa de propósito ou quando ela ficou livre depois de
  // outro agente ter liberado/perdido o lock. Compara currentSelectedIdRef
  // após o await (não a variável `selectedId` do closure) para nunca deixar
  // um lock preso numa conversa que o atendente já trocou enquanto o claim
  // ainda estava em voo.
  async function handleReclaim() {
    if (!selectedId) return;
    const id = selectedId;
    setLockOwnership('checking');
    setSendError(null);
    try {
      const res = await claimSupportConversation(id);
      if (!res.success) return;
      if (currentSelectedIdRef.current !== id) {
        releaseSupportConversation(id).catch(() => {});
        return;
      }
      ownedConversationIdRef.current = id;
      setLockOwnership('owned');
      setDetail((prev) => (prev && prev.conversation.id === id ? { ...prev, conversation: res.conversation } : prev));
    } catch {
      setLockOwnership('other');
    }
  }

  // Liberação manual (botão "Liberar"): deixa a conversa livre para outro
  // atendente de propósito, sem esperar o agente trocar de conversa/sair da
  // página. Nunca reivindica de novo sozinho — só o clique em "Reivindicar"
  // (ou abrir outra conversa e voltar) retoma a posse.
  async function handleRelease() {
    if (!selectedId || lockOwnership !== 'owned') return;
    const id = selectedId;
    try {
      const res = await releaseSupportConversation(id);
      if (ownedConversationIdRef.current === id) ownedConversationIdRef.current = null;
      setLockOwnership('released');
      setDetail((prev) => (prev && prev.conversation.id === id ? { ...prev, conversation: res.conversation } : prev));
    } catch {
      setSendError('Não foi possível liberar a conversa agora.');
    }
  }

  // Encerramento (botão "Encerrar atendimento"): exige a mesma posse que o
  // envio (closeConversation valida locked_by no servidor). Depois de
  // encerrada, a conversa sai da fila ativa (listQueue exclui status
  // closed) — o próximo polling da página já reflete isso sozinho.
  async function handleClose() {
    if (!selectedId || lockOwnership !== 'owned') return;
    if (typeof window !== 'undefined' && !window.confirm('Encerrar este atendimento administrativo?')) return;
    const id = selectedId;
    try {
      const res = await closeSupportConversation(id);
      ownedConversationIdRef.current = null;
      setLockOwnership(null);
      setDetail((prev) => (prev && prev.conversation.id === id ? { ...prev, conversation: res.conversation } : prev));
    } catch {
      setSendError('Não foi possível encerrar o atendimento agora.');
    }
  }

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

          {/* Estado da conversa (aberta/aguardando atendimento/aguardando
              paciente/encerrada) + ações de posse — distinção exigida
              explicitamente para a ETAPA 2 ser funcional, não só leitura. */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#EDF2F7] px-3 py-1.5">
            <span
              className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${STATUS_BADGES[detail.conversation.status].className}`}
            >
              {STATUS_BADGES[detail.conversation.status].label}
            </span>
            {detail.conversation.status !== 'closed' && (
              <div className="flex shrink-0 items-center gap-1.5">
                {lockOwnership === 'owned' ? (
                  <>
                    <button
                      type="button"
                      onClick={handleRelease}
                      className="rounded-[7px] border border-[#CBD5E1] px-2 py-1 text-[10px] font-bold text-[#5B6475] hover:bg-[#F8FAFC]"
                    >
                      Liberar
                    </button>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="rounded-[7px] border border-[#DC2A3B] px-2 py-1 text-[10px] font-bold text-[#DC2A3B] hover:bg-[#FEF2F2]"
                    >
                      Encerrar atendimento
                    </button>
                  </>
                ) : (
                  (lockOwnership === 'other' || lockOwnership === 'released') && (
                    <button
                      type="button"
                      onClick={handleReclaim}
                      className="rounded-[7px] border border-[#0B7F3C] px-2 py-1 text-[10px] font-bold text-[#0B7F3C] hover:bg-[#EAF8EF]"
                    >
                      Reivindicar
                    </button>
                  )
                )}
              </div>
            )}
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

      {/* Rodapé — composer real. Habilitado só quando há conversa selecionada,
          este agente é o dono atual do lock (claim já confirmado pelo
          servidor), a conversa não está encerrada e a janela de 24h da Meta
          ainda está aberta; anexo (paperclip) permanece fora de escopo desta
          etapa. Erro de envio fica visível e o texto digitado é preservado —
          reenviar é só clicar em "Enviar" de novo (novo client_message_id,
          nunca duplica a tentativa anterior que falhou). */}
      {(() => {
        const isClosed = detail?.conversation.status === 'closed';
        const windowOpen = detail?.windowStatus?.withinWindow ?? false;
        const sendEnabled = detail?.agentSendEnabled ?? false;
        const canType = Boolean(detail) && sendEnabled && lockOwnership === 'owned' && !isClosed && windowOpen && !sending;
        const placeholder = !detail
          ? 'Selecione uma conversa'
          : !sendEnabled
            ? 'Envio ainda não habilitado nesta etapa'
            : isClosed
              ? 'Atendimento encerrado'
              : lockOwnership === 'checking'
                ? 'Verificando disponibilidade...'
                : lockOwnership === 'other'
                  ? 'Conversa sendo atendida por outro atendente'
                  : lockOwnership === 'released'
                    ? 'Você liberou esta conversa — reivindique para responder'
                    : !windowOpen
                      ? 'Janela de 24h encerrada — texto livre bloqueado'
                      : sending
                        ? 'Enviando...'
                        : 'Digite sua mensagem...';
        return (
          <div className="flex shrink-0 flex-col gap-1 border-t border-[#EDF2F7] bg-white px-2.5 py-2">
            {sendError && (
              <div className="flex items-center justify-between gap-2 px-1">
                <p className="text-[9.5px] font-semibold text-[#DC2A3B]">{sendError}</p>
                {canType && messageText.trim() && (
                  <button
                    type="button"
                    onClick={handleSendMessage}
                    className="shrink-0 text-[9.5px] font-black text-[#0B7F3C] underline"
                  >
                    Tentar novamente
                  </button>
                )}
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled
                title="Anexo não disponível nesta etapa"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#94A3B8] disabled:cursor-not-allowed"
              >
                <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <input
                type="text"
                value={messageText}
                onChange={(e) => handleMessageTextChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                disabled={!canType}
                placeholder={placeholder}
                title={placeholder}
                className="h-8 min-w-0 flex-1 rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-3 text-[11px] text-[#1A2333] placeholder:text-[#94A3B8] disabled:cursor-not-allowed disabled:text-[#5B6475]"
              />
              <button
                type="button"
                disabled={!canType || !messageText.trim()}
                onClick={handleSendMessage}
                title={canType ? 'Enviar' : placeholder}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0B7F3C] text-white disabled:cursor-not-allowed disabled:bg-[#CBD5E1]"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        );
      })()}
    </section>
  );
}
