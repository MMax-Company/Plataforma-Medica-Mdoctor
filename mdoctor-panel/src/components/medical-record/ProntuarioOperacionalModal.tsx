'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { ProntuarioDecisionBar } from '@/components/medical-record/ProntuarioDecisionBar';
import { ProntuarioConsultStatus } from '@/components/medical-record/ProntuarioConsultStatus';
import { useProntuarioAtendimento, type ClinicalEditForm } from '@/hooks/useProntuarioAtendimento';
import { whatsappContactUrl, isValidCpf } from '@/lib/patient-display';

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

// ── Bloco "Dados do Paciente" (aside) — helpers puros de formatação ────────

function formatPhoneBR(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const local = digits.length > 11 && digits.startsWith('55') ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return raw;
}

function formatCep(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : raw;
}

function parseBirthDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const slash = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (slash) return new Date(Number(slash[3]), Number(slash[2]) - 1, Number(slash[1]));
  return null;
}

function calculateAge(raw: string): number | null {
  const date = parseBirthDate(raw);
  if (!date || Number.isNaN(date.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  const monthDiff = now.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < date.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

function formatBirthDateDisplay(raw: string): string {
  const date = parseBirthDate(raw);
  if (!date) return raw;
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getFullYear()}`;
}

function formatSexoLabel(raw: string): string {
  const text = raw.trim().toLowerCase();
  if (!text) return 'Sexo não informado';
  if (text === 'm' || text.startsWith('masculino')) return 'Masculino';
  if (text === 'f' || text.startsWith('feminino')) return 'Feminino';
  return raw.trim();
}

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

  // 1. Identificação
  const sexoRaw = firstText(clinical.sexo, clinical.paciente_sexo);
  const sexoLabel = sexoRaw === 'Não informado' ? 'Sexo não informado' : formatSexoLabel(sexoRaw);
  const dobRaw = firstText(clinical.data_nascimento, clinical.birth_date);
  const dobAge = dobRaw !== 'Não informado' ? calculateAge(dobRaw) : null;
  const dobLabel =
    dobRaw === 'Não informado'
      ? 'Não informado'
      : `${formatBirthDateDisplay(dobRaw)}${dobAge !== null ? ` (${dobAge} anos)` : ''}`;
  const cpfLabel =
    atendimento && atendimento.paciente_cpf
      ? isValidCpf(atendimento.paciente_cpf)
        ? atendimento.paciente_cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
        : atendimento.paciente_cpf
      : 'Não informado';

  // 2. Atendimento
  const shortAtendimentoId = atendimento ? atendimento.id.slice(0, 8) : '';

  // 3. Contato
  const whatsappLabel = atendimento?.paciente_telefone ? formatPhoneBR(atendimento.paciente_telefone) : 'Não informado';
  const emailLabel = atendimento?.paciente_email || 'Não informado';

  // 4. Endereço — usa campos estruturados quando existirem, senão cai no texto livre da triagem.
  const logradouro = firstText(clinical.logradouro);
  const numero = firstText(clinical.numero);
  const complemento = firstText(clinical.complemento);
  const bairro = firstText(clinical.bairro);
  const cidade = firstText(clinical.cidade);
  const uf = firstText(clinical.uf, clinical.estado);
  const cepRaw = firstText(clinical.cep, clinical.postal_code);
  const freeTextAddress = firstText(clinical.endereco, clinical.address);
  const hasStructuredAddress = logradouro !== 'Não informado' || bairro !== 'Não informado' || cidade !== 'Não informado';
  const addressLines: string[] = hasStructuredAddress
    ? [
        logradouro !== 'Não informado' ? `${logradouro}${numero !== 'Não informado' ? `, ${numero}` : ''}` : null,
        complemento !== 'Não informado' ? complemento : null,
        bairro !== 'Não informado' ? bairro : null,
        cidade !== 'Não informado' ? `${cidade}${uf !== 'Não informado' ? `/${uf}` : ''}` : null,
        cepRaw !== 'Não informado' ? formatCep(cepRaw) : null,
      ].filter((line): line is string => Boolean(line))
    : [freeTextAddress, cepRaw !== 'Não informado' ? formatCep(cepRaw) : null].filter(
        (line): line is string => Boolean(line) && line !== 'Não informado',
      );
  if (!addressLines.length) addressLines.push('Não informado');

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
                    ? 'Consulta de prontuário arquivado — somente leitura'
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
                    📄 Receita Anterior
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

            {consultMode ? <ProntuarioConsultStatus atendimento={atendimento} /> : null}

            <div className="mb-2 grid min-h-0 w-full flex-1 grid-cols-1 items-stretch gap-3 overflow-hidden lg:grid-cols-[240px_1fr]">
              <aside className="flex flex-col justify-between overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex h-full flex-col justify-between overflow-y-auto">
                  <div className="flex flex-col gap-2">
                    <h2 className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      Dados do Paciente
                    </h2>

                    {/* 1. Identificação */}
                    <div className="flex items-start gap-2 border-b border-slate-100 pb-2">
                      <div className="flex h-9 w-9 min-w-[36px] items-center justify-center rounded-full bg-[#eff6ff] text-xs font-black text-[#2563eb]">
                        {initials(atendimento.paciente_nome)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="line-clamp-2 text-[12px] font-black leading-tight text-slate-900">
                          {atendimento.paciente_nome || 'Não informado'}
                        </h3>
                        {socialName !== 'Não informado' ? (
                          <p className="mt-0.5 text-[9px] font-semibold text-slate-600">Nome social: {socialName}</p>
                        ) : null}
                        <span className="mt-1 inline-block rounded bg-[#eff6ff] px-1 py-0.5 text-[8px] font-bold text-[#2563eb]">
                          {sexoLabel}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-0.5 border-b border-slate-100 pb-2 text-[10px] font-semibold text-slate-600">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">🎂 Nascimento</span>
                        <span className="font-bold text-slate-900">{dobLabel}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">🪪 CPF</span>
                        <span className="font-bold text-slate-900">{cpfLabel}</span>
                      </div>
                    </div>

                    {/* 2. Atendimento */}
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-[9px] font-bold">
                      <span className="text-slate-400">Atendimento</span>
                      <span
                        className="cursor-copy whitespace-nowrap text-[#2563eb]"
                        title={`ID completo: ${atendimento.id} (clique para copiar)`}
                        onClick={() => navigator.clipboard?.writeText(atendimento.id)}
                      >
                        {shortAtendimentoId}
                      </span>
                    </div>

                    {/* 3. Contato */}
                    <div className="flex items-center gap-2 border-b border-slate-100 pb-2 text-[10px] font-semibold text-slate-600">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">📞 WhatsApp</span>
                          <span className="font-bold text-slate-900">{whatsappLabel}</span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between">
                          <span className="text-slate-400">✉️ E-mail</span>
                          <span className="max-w-[120px] truncate font-bold text-[#2563eb]">{emailLabel}</span>
                        </div>
                      </div>
                      {whatsappUrl ? (
                        <a
                          href={whatsappUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Abrir conversa no WhatsApp"
                          aria-label="Abrir conversa no WhatsApp"
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] leading-none text-[#16a34a] hover:bg-[#f0fdf4]"
                        >
                          💬
                        </a>
                      ) : null}
                    </div>

                    {/* 4. Endereço */}
                    <div className="border-b border-slate-100 pb-2 text-[10px] font-semibold text-slate-600">
                      <span className="text-slate-400">📍 Endereço</span>
                      <div className="mt-0.5 leading-tight text-slate-900">
                        {addressLines.map((line, index) => (
                          <p key={`${line}-${index}`} className="font-bold">
                            {line}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 5. Dados administrativos — compacto e secundário */}
                  <div className="mt-2 shrink-0 space-y-0.5 text-[8px] font-semibold text-slate-400">
                    <div className="flex items-center justify-between">
                      <span>💳 Pagamento</span>
                      <span className="font-bold text-slate-500">{atendimento.pagamento_status || 'Não informado'}</span>
                    </div>
                    <div>
                      <span>🔒 Consentimentos</span>
                      <p className="mt-0.5 leading-tight text-slate-500">{consentSummary}</p>
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

            {consultMode ? (
              <footer className="flex h-10 w-full shrink-0 items-center justify-end bg-white">
                <button type="button" className={headerBtnClass} onClick={onClose}>
                  Fechar consulta
                </button>
              </footer>
            ) : (
              <ProntuarioDecisionBar
                notes={notes}
                onNotesChange={setNotes}
                onReject={() => void handleReject()}
                onApprove={() => void handleApprove()}
                disabled={actionLoading === 'save'}
                loadingAction={actionLoading === 'approve' ? 'approve' : actionLoading === 'reject' ? 'reject' : null}
              />
            )}
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
