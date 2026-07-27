'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { ProntuarioDecisionBar } from '@/components/medical-record/ProntuarioDecisionBar';
import { useProntuarioAtendimento, type ClinicalEditForm } from '@/hooks/useProntuarioAtendimento';
import { whatsappContactUrl } from '@/lib/patient-display';

interface ProntuarioOperacionalModalProps {
  atendimentoId: string | null;
  open: boolean;
  consultMode?: boolean;
  onClose: () => void;
  onCompleted?: () => void;
  onApproved?: (id: string) => void;
}

const CLINICAL_LABELS: Record<string, string> = {
  'QUEIXA PRINCIPAL': 'Queixa Principal',
  'HISTÓRICO CLÍNICO': 'Histórico Clínico',
  'EXAME FÍSICO': 'Exame Físico',
  ALERGIAS: 'Alergias',
  'MEDICAÇÕES EM USO': 'Medicações em Uso',
  'CONDUTA MÉDICA': 'Conduta Médica',
};

const CLINICAL_EMOJI: Record<string, string> = {
  'QUEIXA PRINCIPAL': '💬',
  'HISTÓRICO CLÍNICO': '📄',
  'EXAME FÍSICO': '🩺',
  ALERGIAS: '🛡️',
  'MEDICAÇÕES EM USO': '💊',
  'CONDUTA MÉDICA': '📋',
};

const headerBtnClass =
  'border border-slate-300 bg-white px-3 py-1 rounded-lg font-bold text-[10px] text-slate-700 uppercase tracking-wide hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45';

const headerBtnCompactClass =
  'border border-slate-300 bg-white px-2.5 py-1 rounded-lg font-bold text-[9px] text-slate-700 uppercase tracking-wide hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45';

function ClinicalBlock({
  title,
  value,
  field,
  editing,
  editForm,
  onEdit,
  conduct = false,
}: {
  title: string;
  value: string;
  field?: keyof ClinicalEditForm;
  editing: boolean;
  editForm: ClinicalEditForm | null;
  onEdit?: (field: keyof ClinicalEditForm, value: string) => void;
  conduct?: boolean;
}) {
  const editValue = field && editForm ? editForm[field] : value;
  const label = CLINICAL_LABELS[title] || title;
  const emoji = CLINICAL_EMOJI[title] || '💬';
  const condutaParts = value.split(/\n\n+/);
  const condutaPrimary = condutaParts[0] || value;
  const condutaSecondary = condutaParts.slice(1).join('\n\n');

  const sectionClass = conduct
    ? 'bg-white border border-slate-200 rounded-xl p-2 flex gap-2 shadow-sm flex-1 items-start overflow-hidden min-h-0'
    : 'bg-white border border-slate-200 rounded-xl p-2 flex gap-2 shadow-sm items-center shrink-0';

  return (
    <section className={sectionClass}>
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#eff6ff] text-xs text-[#2563eb]">
        {emoji}
      </div>
      <div className={`min-w-0 flex-1 ${conduct ? 'flex h-full w-full flex-col justify-between overflow-hidden' : ''}`}>
        <h4 className="mb-0.5 text-[8.5px] font-bold uppercase leading-none tracking-wide text-slate-400">
          {label}
        </h4>
        {editing && field && onEdit ? (
          <textarea
            className="mt-1 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-2 text-[10.5px] leading-tight text-slate-700 focus:border-blue-500 focus:outline-none"
            value={editValue}
            onChange={(event) => onEdit(field, event.target.value)}
            rows={conduct ? 4 : 3}
          />
        ) : conduct ? (
          <>
            <p className="text-[10.5px] font-medium leading-normal text-slate-700">{condutaPrimary}</p>
            {condutaSecondary ? (
              <p className="border-t border-slate-100 pt-1 text-[10px] font-normal leading-tight text-slate-500">
                {condutaSecondary}
              </p>
            ) : null}
          </>
        ) : (
          <p className="whitespace-pre-line text-[10.5px] font-medium leading-tight text-slate-700">{value}</p>
        )}
      </div>
    </section>
  );
}

export function ProntuarioOperacionalModal({
  atendimentoId,
  open,
  consultMode = false,
  onClose,
  onCompleted,
  onApproved,
}: ProntuarioOperacionalModalProps) {
  const prontuario = useProntuarioAtendimento(atendimentoId, open);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open || !atendimentoId || !mounted) return null;

  const {
    atendimento,
    clinical,
    displayBlocks,
    eligibilityMessage,
    loading,
    error,
    notes,
    setNotes,
    editing,
    editForm,
    actionLoading,
    hasAttachedPrescription,
    startEditing,
    cancelEditing,
    updateEditField,
    saveClinicalEdit,
    viewAttachedPrescription,
    approveAttendance,
    rejectAttendance,
    initials,
    firstText,
  } = prontuario;

  const eligible = atendimento?.elegibilidade?.eligible !== false;

  const phone = (atendimento?.paciente_telefone ?? '').replace(/\D/g, '');
  const whatsappUrl = phone.length >= 10 ? `https://wa.me/55${phone}` : null;

  async function handleApprove() {
    const ok = await approveAttendance();
    if (ok) { onApproved?.(atendimentoId ?? ''); onClose(); }
  }

  async function handleReject() {
    const ok = await rejectAttendance();
    if (ok) { onCompleted?.(); onClose(); }
  }

  const patientRows = atendimento
    ? [
        {
          label: '📅 Data de nascimento',
          value: firstText(clinical.data_nascimento, clinical.birth_date),
        },
        { label: '🪪 CPF', value: atendimento.paciente_cpf || 'Não informado' },
        {
          label: '✉️ E-mail',
          value: atendimento.paciente_email || 'Não informado',
          highlight: true,
        },
        { label: '📞 WhatsApp', value: atendimento.paciente_telefone || 'Não informado' },
        {
          label: '📍 Endereço',
          value: firstText(clinical.endereco, clinical.address),
          multiline: true,
        },
      ]
    : [];

  const cepValue = atendimento ? firstText(clinical.cep, clinical.postal_code) : 'Não informado';
  const socialName = atendimento
    ? firstText(clinical.nome_social, clinical.social_name)
    : 'Não informado';
  const consentSummary = atendimento
    ? [
        clinical.lgpd_accepted === true ? 'LGPD ✓' : 'LGPD —',
        clinical.telemedicine_consent_accepted === true ? 'Telemedicina ✓' : 'Telemedicina —',
        clinical.terms_of_use_accepted === true ? 'Termos ✓' : 'Termos —',
      ].join(' · ')
    : 'Não informado';

  return createPortal(
    <div
      id="modalProntuario"
      className="modal-overlay prontuario-modal-overlay"
      aria-hidden={false}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="modal-content prontuario-modal-content flex flex-col justify-between"
        role="region"
        aria-labelledby="prontuario-modal-title"
      >
        {loading && !atendimento ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
            Carregando prontuário...
          </div>
        ) : null}

        {error && !atendimento ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-sm text-slate-600">
            <p>{error}</p>
            <button type="button" className={headerBtnClass} onClick={onClose}>
              ← Voltar para painel
            </button>
          </div>
        ) : null}

        {atendimento && displayBlocks ? (
          <>
            <header className="mb-2 flex h-9 w-full shrink-0 items-center justify-between">
              <button type="button" className={headerBtnClass} onClick={onClose}>
                ← Voltar para painel
              </button>

              <div className="text-center">
                <h1
                  id="prontuario-modal-title"
                  className="text-[15px] font-black uppercase leading-none tracking-tight text-slate-950"
                >
                  Prontuário Médico
                </h1>
                <p className="mt-0.5 text-[9px] font-semibold text-slate-400">
                  {consultMode
                    ? 'Consulta de prontuário — somente leitura'
                    : 'Avalie as informações do paciente e aprove o atendimento'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className={headerBtnCompactClass}
                    onClick={() => void viewAttachedPrescription()}
                    disabled={!hasAttachedPrescription}
                  >
                    📄 Receita Anexada
                  </button>
                  {hasAttachedPrescription && (() => {
                    const q = atendimento.dados_clinicos?.prescription_image_quality;
                    if (!q || q.grade === 'not_analyzed') return null;
                    const map = {
                      adequate: { dot: 'bg-green-500', text: 'text-green-700', label: 'Legível' },
                      marginal: { dot: 'bg-yellow-400', text: 'text-yellow-700', label: 'Verificar' },
                      inadequate: { dot: 'bg-red-500', text: 'text-red-700', label: 'Ilegível' },
                    } as const;
                    const style = map[q.grade as keyof typeof map];
                    if (!style) return null;
                    const issues = q.details?.issues ?? [];
                    const tip = issues.length
                      ? issues.map(i => i.replace(/_/g, ' ')).join(', ')
                      : 'Imagem adequada para leitura';
                    return (
                      <span
                        className={`flex items-center gap-0.5 rounded-full border border-current px-1.5 py-0.5 text-[8px] font-bold uppercase ${style.text}`}
                        title={tip}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                        {style.label}
                      </span>
                    );
                  })()}
                </div>
                <button
                  type="button"
                  className={headerBtnClass}
                  onClick={() => {
                    if (editing) {
                      cancelEditing();
                    } else {
                      startEditing();
                    }
                  }}
                  disabled={consultMode}
                  title={consultMode ? 'Consulta arquivada — edição indisponível' : undefined}
                >
                  ✏️ {editing ? 'Bloquear' : 'Editar'}
                </button>
              </div>
            </header>

            <div
              className={`mb-2 flex h-7 w-full shrink-0 items-center justify-between rounded-xl border px-3 ${
                eligible ? 'border-[#bbf7d0] bg-[#f0fdf4]' : 'border-amber-200 bg-amber-50'
              }`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ${
                    eligible ? 'bg-[#22c55e]' : 'bg-amber-500'
                  }`}
                >
                  {eligible ? (
                    '✓'
                  ) : (
                    <Check className="h-2.5 w-2.5" aria-hidden="true" />
                  )}
                </div>
                <p className={`truncate text-[10px] font-bold ${eligible ? 'text-[#166534]' : 'text-amber-900'}`}>
                  CRITÉRIOS DE ELEGIBILIDADE:{' '}
                  <span className={`ml-1 font-normal ${eligible ? 'text-[#15803d]' : 'text-amber-800'}`}>
                    {eligibilityMessage}
                  </span>
                </p>
              </div>
              <span
                className={`ml-2 shrink-0 rounded-full border bg-white px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider ${
                  eligible ? 'border-[#bbf7d0] text-[#166534]' : 'border-amber-200 text-amber-800'
                }`}
              >
                ✓ Verificado
              </span>
            </div>

            {error ? (
              <div
                className="mb-2 shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800"
                role="alert"
              >
                {error}
              </div>
            ) : null}

            <div className="mb-2 grid min-h-0 w-full flex-1 grid-cols-[240px_1fr] items-stretch gap-3 overflow-hidden">
              <aside className="flex flex-col justify-between overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex h-full flex-col justify-between">
                  <h2 className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                    Dados do Paciente
                  </h2>

                  <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 pb-2">
                    <div className="flex h-9 w-9 min-w-[36px] items-center justify-center rounded-full bg-[#eff6ff] text-xs font-black text-[#2563eb]">
                      {initials(atendimento.paciente_nome)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <h3 className="text-[12px] font-black leading-none text-slate-900">
                          {atendimento.paciente_nome || 'Não informado'}
                        </h3>
                        <span className="rounded bg-[#eff6ff] px-1 py-0.5 text-[8px] font-bold text-[#2563eb]">
                          {firstText(clinical.idade, clinical.age)}
                        </span>
                      </div>
                      {socialName !== 'Não informado' ? (
                        <p className="mt-0.5 text-[9px] font-semibold text-slate-600">Nome social: {socialName}</p>
                      ) : null}
                      <p className="mt-0.5 text-[8.5px] font-bold text-slate-400">
                        Atendimento: <span className="break-all text-[#2563eb]">{atendimento.id}</span>
                      </p>
                      {whatsappUrl ? (
                        <a
                          href={whatsappUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-0.5 block text-[8.5px] font-bold text-[#16a34a] hover:underline"
                        >
                          💬 Contato via WhatsApp
                        </a>
                      ) : (
                        <span className="mt-0.5 block text-[8.5px] font-bold text-[#16a34a]">
                          💬 Contato via WhatsApp
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col justify-between gap-0.5 py-1 text-[10px] font-semibold text-slate-600">
                    {patientRows.map(({ label, value, highlight, multiline }) => (
                      <div
                        key={label}
                        className={`flex border-b border-slate-50 pb-0.5 ${
                          multiline ? 'items-start gap-1' : 'items-center justify-between'
                        }`}
                      >
                        <span className="text-slate-400">{label}</span>
                        <span
                          className={`font-bold ${highlight ? 'text-[#2563eb]' : 'text-slate-900'} ${
                            multiline ? 'max-w-[120px] text-right leading-tight' : ''
                          } ${label.includes('E-mail') ? 'max-w-[120px] truncate' : ''}`}
                        >
                          {value}
                        </span>
                      </div>
                    ))}
                    <div className="flex shrink-0 items-center justify-between border-t border-slate-100 pt-1">
                      <span className="text-slate-400">📮 CEP</span>
                      <span className="font-bold text-slate-900">{cepValue}</span>
                    </div>
                    <div className="flex shrink-0 items-center justify-between border-t border-slate-100 pt-1">
                      <span className="text-slate-400">💳 Pagamento</span>
                      <span className="font-bold text-slate-900">{atendimento.pagamento_status || 'Não informado'}</span>
                    </div>
                    <div className="shrink-0 border-t border-slate-100 pt-1">
                      <span className="text-slate-400">🔒 Consentimentos</span>
                      <p className="mt-0.5 text-[8px] font-bold leading-tight text-slate-900">{consentSummary}</p>
                    </div>
                  </div>
                </div>
              </aside>

              <main className="flex h-full min-h-0 flex-col justify-between gap-1.5 overflow-hidden">
                <ClinicalBlock
                  title="QUEIXA PRINCIPAL"
                  value={displayBlocks.queixa}
                  field="queixa_principal"
                  editing={editing}
                  editForm={editForm}
                  onEdit={updateEditField}
                />
                <ClinicalBlock
                  title="HISTÓRICO CLÍNICO"
                  value={displayBlocks.historico}
                  field="historico_clinico"
                  editing={editing}
                  editForm={editForm}
                  onEdit={updateEditField}
                />
                <ClinicalBlock
                  title="EXAME FÍSICO"
                  value={displayBlocks.exame}
                  field="exame_fisico"
                  editing={editing}
                  editForm={editForm}
                  onEdit={updateEditField}
                />
                <div className="grid shrink-0 grid-cols-2 gap-2">
                  <ClinicalBlock
                    title="ALERGIAS"
                    value={displayBlocks.alergias}
                    field="alergias"
                    editing={editing}
                    editForm={editForm}
                    onEdit={updateEditField}
                  />
                  <ClinicalBlock
                    title="MEDICAÇÕES EM USO"
                    value={displayBlocks.medicacao}
                    field="medicacao_em_uso"
                    editing={editing}
                    editForm={editForm}
                    onEdit={updateEditField}
                  />
                </div>
                <ClinicalBlock
                  title="CONDUTA MÉDICA"
                  value={displayBlocks.conduta}
                  field="conduta"
                  editing={editing}
                  editForm={editForm}
                  onEdit={updateEditField}
                  conduct
                />
              </main>
            </div>

            {!consultMode ? (
              <ProntuarioDecisionBar
                notes={notes}
                onNotesChange={setNotes}
                onReject={() => void handleReject()}
                onApprove={() => void handleApprove()}
                disabled={actionLoading === 'save'}
                loadingAction={actionLoading === 'approve' ? 'approve' : actionLoading === 'reject' ? 'reject' : null}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
