'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Users as UsersIcon } from 'lucide-react';
import { logout, requireSession } from '@/services/auth.service';
import {
  addAdminNote,
  fetchAdminAtendimento,
  forwardToDoctor,
  hasPreviousPrescriptionFile,
  medicoResponsavel,
  resendPaymentLink,
  resendTypebotLink,
  resolveAdminNote,
  type AdminAtendimento,
  type AdminNote,
} from '@/services/admin.service';
import { Button, Card, FieldRow, StatusPill } from '@/components/ui/DesignSystem';
import { MedicalPanelHeader } from '@/components/medical/MedicalPanelHeader';

function canForwardToMedicalSupport(atendimento: AdminAtendimento): boolean {
  const status = String(atendimento.status || '').trim().toLowerCase();
  const delivered =
    status === 'delivered' ||
    status === 'finished' ||
    atendimento.dados_clinicos?.entrega_receita?.status === 'sent';

  return (
    delivered &&
    atendimento.condicao !== 'suporte_whatsapp' &&
    atendimento.dados_clinicos?.queue_type !== 'support'
  );
}

// ─── Journey derivation ───────────────────────────────────────────────────────

type StepState = 'done' | 'current' | 'pending' | 'blocked';

type JourneyStep = {
  id: string;
  label: string;
  detail?: string;
  state: StepState;
};

function deriveJourney(a: AdminAtendimento): JourneyStep[] {
  const s = (a.status || '').toLowerCase();
  const paid = String(a.pagamento_status || '').toUpperCase() === 'CONFIRMADO';
  const prevPrescription = hasPreviousPrescriptionFile(a);

  const isWaiting = ['waiting', 'queue', 'fila', 'triaged'].includes(s);
  const isAwaitingReceipt = s === 'awaiting_prescription_upload';
  const isInAttendance = ['em_atendimento', 'under_review', 'approved', 'receita_em_edicao'].includes(s);
  const isReceiptIssued = ['receita_emitida', 'memed_processing', 'awaiting_validation'].includes(s);
  const isReady = ['ready', 'validated', 'aprovado'].includes(s);
  const isDelivered = ['delivered', 'finished'].includes(s);
  const isRejected = ['rejected', 'recusado', 'cancelado'].includes(s);

  const done: StepState = 'done';
  const current: StepState = 'current';
  const pending: StepState = 'pending';
  const blocked: StepState = 'blocked';

  return [
    { id: 'whatsapp', label: 'WhatsApp', detail: 'Contato inicial', state: done },
    { id: 'typebot', label: 'Typebot', detail: 'Formulário preenchido', state: done },
    { id: 'triagem', label: 'Triagem', detail: 'Dados recebidos', state: done },
    {
      id: 'pagamento',
      label: 'Pagamento',
      detail: paid ? 'Confirmado' : isRejected ? 'Não realizado' : 'Aguardando',
      state: paid ? done : isRejected ? pending : current,
    },
    {
      id: 'receita_ant',
      label: 'Receita anterior',
      detail: prevPrescription
        ? 'Recebida'
        : isAwaitingReceipt
        ? 'Aguardando envio'
        : !paid
        ? 'Pendente'
        : 'Pendente',
      state: prevPrescription
        ? done
        : isAwaitingReceipt
        ? current
        : paid && !isRejected
        ? current
        : pending,
    },
    {
      id: 'avaliacao',
      label: 'Avaliação médica',
      detail: isRejected
        ? 'Recusado pelo médico'
        : isInAttendance
        ? 'Em andamento'
        : isReceiptIssued || isReady || isDelivered
        ? 'Concluída'
        : 'Aguardando',
      state: isRejected
        ? blocked
        : isInAttendance
        ? current
        : isReceiptIssued || isReady || isDelivered
        ? done
        : pending,
    },
    {
      id: 'receita',
      label: 'Receita emitida',
      detail: isReady || isDelivered ? 'Emitida e validada' : isReceiptIssued ? 'Em emissão' : '—',
      state: isDelivered || isReady ? done : isReceiptIssued ? current : pending,
    },
    {
      id: 'entrega',
      label: 'Entrega',
      detail: isDelivered ? 'Receita enviada ao paciente' : isReady ? 'Pronta para envio' : '—',
      state: isDelivered ? done : isReady ? current : pending,
    },
  ];
}

// ─── Step display ─────────────────────────────────────────────────────────────

function StepDot({ state }: { state: StepState }) {
  if (state === 'done')
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0BA84F] text-white">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M2 7l4 4 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  if (state === 'current')
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-[#1557FF] bg-[#EEF4FF]">
        <span className="h-3 w-3 rounded-full bg-[#1557FF]" />
      </span>
    );
  if (state === 'blocked')
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    );
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-[#E5EAF2] bg-white">
      <span className="h-2 w-2 rounded-full bg-[#D1D5DB]" />
    </span>
  );
}

function stepLabelColor(state: StepState) {
  if (state === 'done') return 'text-[#1E1E1E]';
  if (state === 'current') return 'text-[#1557FF] font-black';
  if (state === 'blocked') return 'text-red-600';
  return 'text-[#94A3B8]';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusLabel(s: string) {
  const v = (s || '').toLowerCase();
  if (['waiting', 'queue', 'fila', 'triaged'].includes(v)) return 'Aguardando';
  if (v === 'awaiting_prescription_upload') return 'Aguardando receita';
  if (['em_atendimento', 'under_review', 'approved'].includes(v)) return 'Em atendimento';
  if (['receita_emitida', 'memed_processing', 'awaiting_validation', 'receita_em_edicao'].includes(v)) return 'Receita emitida';
  if (['ready', 'validated', 'aprovado'].includes(v)) return 'Receita pronta';
  if (['delivered', 'finished'].includes(v)) return 'Entregue';
  if (['rejected', 'recusado', 'cancelado'].includes(v)) return 'Recusado';
  return s;
}

function statusTone(s: string): 'primary' | 'success' | 'danger' | 'gold' | 'secondary' {
  const v = (s || '').toLowerCase();
  if (['waiting', 'queue', 'fila', 'triaged', 'awaiting_prescription_upload'].includes(v)) return 'primary';
  if (['em_atendimento', 'under_review', 'approved', 'receita_emitida', 'memed_processing', 'receita_em_edicao'].includes(v)) return 'gold';
  if (['ready', 'validated', 'aprovado', 'delivered', 'finished'].includes(v)) return 'success';
  if (['rejected', 'recusado', 'cancelado'].includes(v)) return 'danger';
  return 'secondary';
}

function fmt(v?: string) {
  if (!v) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(v));
}

function maskCpf(v = '') {
  const d = v.replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : v;
}

function maskPhone(p?: string) {
  if (!p) return '—';
  const d = p.replace(/\D/g, '');
  const n = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return p;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminPacientePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [atendimento, setAtendimento] = useState<AdminAtendimento | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [noteText, setNoteText] = useState('');
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [copyLabel, setCopyLabel] = useState<string | null>(null);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardMotivo, setForwardMotivo] = useState('');
  const [forwardLoading, setForwardLoading] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    requireSession()
      .then(() => fetchAdminAtendimento(id))
      .then((r) => setAtendimento(r.atendimento))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Erro ao carregar atendimento';
        setError(msg);
        if (msg.toLowerCase().includes('sess')) router.replace('/login');
      })
      .finally(() => setLoading(false));
  }, [id, router]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function handleAddNote() {
    if (!noteText.trim()) return;
    setNoteLoading(true);
    setNoteError(null);
    try {
      const r = await addAdminNote(id, noteText.trim());
      setNoteText('');
      setAtendimento((prev) => {
        if (!prev) return prev;
        const existing = prev.dados_clinicos?.observacoes_admin || [];
        return {
          ...prev,
          dados_clinicos: {
            ...prev.dados_clinicos,
            observacoes_admin: [...existing, r.nota],
          },
        };
      });
      showToast('Observação registrada.');
    } catch (e: unknown) {
      setNoteError(e instanceof Error ? e.message : 'Erro ao salvar observação');
    } finally {
      setNoteLoading(false);
    }
  }

  async function handleResolveNote(noteId: string) {
    try {
      await resolveAdminNote(id, noteId);
      setAtendimento((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          dados_clinicos: {
            ...prev.dados_clinicos,
            observacoes_admin: (prev.dados_clinicos?.observacoes_admin || []).map(
              (n: AdminNote) => (n.id === noteId ? { ...n, resolvido: true } : n),
            ),
          },
        };
      });
      showToast('Pendência marcada como resolvida.');
    } catch {
      showToast('Erro ao resolver pendência.');
    }
  }

  async function handleResendTypebot() {
    setActionLoading('typebot');
    try {
      const r = await resendTypebotLink(id);
      if (r.sent) {
        showToast('Link do Typebot enviado por WhatsApp.');
      } else {
        setCopyLabel(r.link);
        navigator.clipboard?.writeText(r.link).catch(() => undefined);
        showToast('WhatsApp não configurado — link copiado para área de transferência.');
      }
    } catch {
      showToast('Erro ao reenviar link.');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleResendPayment() {
    setActionLoading('payment');
    try {
      const r = await resendPaymentLink(id);
      if (r.sent && r.link) {
        showToast('Link de pagamento enviado por WhatsApp.');
      } else if (r.link) {
        setCopyLabel(r.link);
        navigator.clipboard?.writeText(r.link).catch(() => undefined);
        showToast('Link de pagamento copiado para área de transferência.');
      } else {
        showToast('Link de pagamento não disponível. Verifique o Stripe.');
      }
    } catch {
      showToast('Erro ao reenviar link de pagamento.');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleForwardToDoctor() {
    if (!forwardMotivo.trim()) return;
    setForwardLoading(true);
    try {
      const r = await forwardToDoctor(id, forwardMotivo.trim());
      setAtendimento(r.atendimento);
      setForwardOpen(false);
      setForwardMotivo('');
      showToast('Atendimento encaminhado ao médico.');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Erro ao encaminhar ao médico.');
    } finally {
      setForwardLoading(false);
    }
  }

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F8FAFC] text-sm text-[#5B6475]">
        Carregando jornada do paciente...
      </main>
    );
  }

  const a = atendimento;
  const notes: AdminNote[] = a?.dados_clinicos?.observacoes_admin || [];
  const journey = a ? deriveJourney(a) : [];

  return (
    <main className="flex min-h-screen w-full flex-col bg-[#F6F9FD] text-[#071B3A]">
      <MedicalPanelHeader
        operational
        title={a?.paciente_nome || 'Paciente'}
        subtitle="Jornada do atendimento"
        titleAlign="left"
        recordButtonLabel="Relação de Pacientes"
        recordButtonIcon={<UsersIcon className="h-4 w-4" aria-hidden="true" />}
        onOpenMedicalRecord={() => router.push('/admin/pacientes')}
        onLogout={handleLogout}
      />

      {toast && (
        <div className="fixed right-5 top-20 z-50 rounded-[14px] border border-emerald-200 bg-white px-4 py-3 text-sm font-bold text-[#0BA84F] shadow-[0_8px_24px_rgba(0,0,0,0.1)]">
          {toast}
        </div>
      )}

      <div className="space-y-6 p-4 sm:p-6">
        {error && (
          <div className="rounded-[14px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {a && (
          <>
            {/* Patient info + status */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <p className="mb-4 text-xs font-black uppercase tracking-[0.08em] text-[#5B6475]">
                  Dados do paciente
                </p>
                <dl className="space-y-2">
                  <FieldRow label="Nome" value={a.paciente_nome} />
                  <FieldRow label="CPF" value={a.paciente_cpf ? maskCpf(a.paciente_cpf) : '—'} />
                  <FieldRow label="Telefone" value={maskPhone(a.paciente_telefone)} />
                  <FieldRow label="E-mail" value={a.paciente_email || '—'} />
                  <FieldRow label="Doença / Condição" value={a.condicao || '—'} />
                  <FieldRow label="Risco" value={a.risco || '—'} />
                </dl>
              </Card>

              <Card className="p-5">
                <p className="mb-4 text-xs font-black uppercase tracking-[0.08em] text-[#5B6475]">
                  Status do atendimento
                </p>
                <dl className="space-y-2">
                  <FieldRow
                    label="Status"
                    value={
                      <StatusPill tone={statusTone(a.status)}>{statusLabel(a.status)}</StatusPill>
                    }
                  />
                  <FieldRow
                    label="Pagamento"
                    value={
                      <StatusPill
                        tone={a.pagamento_status === 'CONFIRMADO' ? 'success' : 'gold'}
                      >
                        {a.pagamento_status === 'CONFIRMADO' ? 'Confirmado' : a.pagamento_status || 'Pendente'}
                      </StatusPill>
                    }
                  />
                  <FieldRow
                    label="Elegibilidade"
                    value={
                      a.elegibilidade?.eligible === false ? (
                        <StatusPill tone="danger">Inelegível</StatusPill>
                      ) : a.elegibilidade?.eligible === true ? (
                        <StatusPill tone="success">Elegível</StatusPill>
                      ) : (
                        '—'
                      )
                    }
                  />
                  <FieldRow
                    label="Receita anterior"
                    value={
                      hasPreviousPrescriptionFile(a) ? (
                        <StatusPill tone="success">Recebida</StatusPill>
                      ) : (
                        <StatusPill tone="gold">Pendente</StatusPill>
                      )
                    }
                  />
                  <FieldRow label="Entrada" value={fmt(a.criado_em)} />
                  <FieldRow label="Última atualização" value={fmt(a.atualizado_em)} />
                  {medicoResponsavel(a) && (
                    <FieldRow label="Médico responsável" value={medicoResponsavel(a)!} />
                  )}
                </dl>
              </Card>
            </div>

            {/* Journey timeline */}
            <Card className="overflow-hidden p-5">
              <p className="mb-5 text-xs font-black uppercase tracking-[0.08em] text-[#5B6475]">
                Jornada do paciente
              </p>
              {/* Desktop: horizontal */}
              <div className="hidden sm:block">
                <div className="flex items-start">
                  {journey.map((step, i) => (
                    <div key={step.id} className="flex flex-1 flex-col items-center">
                      <div className="flex w-full items-center">
                        {i > 0 && (
                          <div
                            className={`h-0.5 flex-1 ${
                              journey[i - 1].state === 'done' && step.state !== 'pending'
                                ? 'bg-[#0BA84F]'
                                : 'bg-[#E5EAF2]'
                            }`}
                          />
                        )}
                        <StepDot state={step.state} />
                        {i < journey.length - 1 && (
                          <div
                            className={`h-0.5 flex-1 ${
                              step.state === 'done' ? 'bg-[#0BA84F]' : 'bg-[#E5EAF2]'
                            }`}
                          />
                        )}
                      </div>
                      <div className="mt-2 max-w-[90px] text-center">
                        <p
                          className={`text-[11px] font-bold leading-tight ${stepLabelColor(step.state)}`}
                        >
                          {step.label}
                        </p>
                        {step.detail && (
                          <p className="mt-0.5 text-[10px] leading-tight text-[#94A3B8]">
                            {step.detail}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Mobile: vertical */}
              <div className="space-y-3 sm:hidden">
                {journey.map((step) => (
                  <div key={step.id} className="flex items-start gap-3">
                    <StepDot state={step.state} />
                    <div className="pt-0.5">
                      <p className={`text-sm font-bold ${stepLabelColor(step.state)}`}>
                        {step.label}
                      </p>
                      {step.detail && (
                        <p className="text-xs text-[#94A3B8]">{step.detail}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Actions */}
            <Card className="p-5">
              <p className="mb-4 text-xs font-black uppercase tracking-[0.08em] text-[#5B6475]">
                Ações administrativas
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={handleResendTypebot}
                  disabled={actionLoading === 'typebot'}
                  tone="secondary"
                >
                  {actionLoading === 'typebot' ? 'Enviando...' : '🔗 Reenviar link Typebot'}
                </Button>
                <Button
                  onClick={handleResendPayment}
                  disabled={actionLoading === 'payment'}
                  tone="secondary"
                >
                  {actionLoading === 'payment' ? 'Enviando...' : '💳 Reenviar link de pagamento'}
                </Button>
                {a.paciente_telefone && (
                  <a
                    href={`https://wa.me/${a.paciente_telefone.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#E5EAF2] bg-white px-3.5 text-sm font-bold shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:-translate-y-0.5 hover:bg-[#F8FAFC]"
                  >
                    <span className="text-[#25D366]">WhatsApp</span> direto
                  </a>
                )}
                {canForwardToMedicalSupport(a) &&
                  (a.dados_clinicos?.queue_type === 'medical_support' ? (
                    <StatusPill tone="gold">Aguardando resposta médica</StatusPill>
                  ) : (
                    <Button onClick={() => setForwardOpen((value) => !value)} tone="primary">
                      🩺 Encaminhar ao Médico
                    </Button>
                  ))}
              </div>

              {forwardOpen && (
                <div className="mt-3 space-y-2 rounded-[14px] border border-[#E5EAF2] bg-[#F8FAFC] p-4">
                  <p className="text-xs font-bold text-[#5B6475]">
                    Descreva a dúvida clínica a ser esclarecida pelo médico:
                  </p>
                  <textarea
                    value={forwardMotivo}
                    onChange={(event) => setForwardMotivo(event.target.value)}
                    placeholder="Ex.: paciente relata dúvida sobre a orientação da receita entregue..."
                    rows={2}
                    className="w-full resize-none rounded-[10px] border border-[#E5EAF2] bg-white px-3 py-2 text-sm text-[#1E1E1E] outline-none transition focus:border-[#1557FF] focus:ring-4 focus:ring-[#EEF4FF] placeholder:text-[#94A3B8]"
                  />
                  <div className="flex justify-end gap-2">
                    <Button onClick={() => setForwardOpen(false)} tone="soft" className="h-9 text-xs">
                      Cancelar
                    </Button>
                    <Button
                      onClick={handleForwardToDoctor}
                      disabled={forwardLoading || !forwardMotivo.trim()}
                      tone="primary"
                      className="h-9 text-xs"
                    >
                      {forwardLoading ? 'Encaminhando...' : 'Confirmar encaminhamento'}
                    </Button>
                  </div>
                </div>
              )}

              {copyLabel && (
                <div className="mt-3 rounded-[14px] border border-[#E5EAF2] bg-[#F8FAFC] px-4 py-3 font-mono text-xs text-[#5B6475]">
                  {copyLabel}
                </div>
              )}
            </Card>

            {/* Admin notes */}
            <Card className="p-5">
              <p className="mb-4 text-xs font-black uppercase tracking-[0.08em] text-[#5B6475]">
                Observações administrativas
              </p>

              {/* Note list */}
              {notes.length > 0 ? (
                <div className="mb-4 space-y-3">
                  {notes.map((note) => (
                    <div
                      key={note.id}
                      className={`rounded-[14px] border p-4 ${
                        note.resolvido
                          ? 'border-[#E5EAF2] bg-[#F8FAFC] opacity-60'
                          : 'border-amber-200 bg-amber-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-[#1E1E1E]">{note.texto}</p>
                          <p className="mt-1 text-xs text-[#94A3B8]">
                            {note.autor} · {fmt(note.criado_em)}
                            {note.resolvido && ' · Resolvida'}
                          </p>
                        </div>
                        {!note.resolvido && (
                          <button
                            type="button"
                            onClick={() => handleResolveNote(note.id)}
                            className="shrink-0 rounded-[10px] border border-emerald-200 bg-white px-3 py-1.5 text-xs font-bold text-[#0BA84F] hover:bg-emerald-50"
                          >
                            Resolver
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mb-4 text-sm text-[#94A3B8]">Nenhuma observação registrada.</p>
              )}

              {/* Add note */}
              <div className="space-y-2">
                <textarea
                  ref={textareaRef}
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Registrar observação administrativa..."
                  rows={3}
                  className="w-full resize-none rounded-[14px] border border-[#E5EAF2] bg-white px-4 py-3 text-sm text-[#1E1E1E] outline-none transition focus:border-[#1557FF] focus:ring-4 focus:ring-[#EEF4FF] placeholder:text-[#94A3B8]"
                />
                {noteError && (
                  <p className="text-xs font-semibold text-red-600">{noteError}</p>
                )}
                <div className="flex justify-end">
                  <Button
                    onClick={handleAddNote}
                    disabled={noteLoading || !noteText.trim()}
                  >
                    {noteLoading ? 'Salvando...' : 'Registrar observação'}
                  </Button>
                </div>
              </div>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
