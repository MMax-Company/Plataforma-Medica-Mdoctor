'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check } from 'lucide-react';
import { ProntuarioDecisionBar } from '@/components/medical-record/ProntuarioDecisionBar';
import { useProntuarioAtendimento, type ClinicalEditForm } from '@/hooks/useProntuarioAtendimento';

interface ProntuarioOperacionalModalProps {
  atendimentoId: string | null;
  open: boolean;
  onClose: () => void;
  onCompleted?: () => void;
}

function ClinicalBlock({
  title,
  value,
  field,
  editing,
  editForm,
  onEdit,
  wide = true,
  conduct = false,
}: {
  title: string;
  value: string;
  field?: keyof ClinicalEditForm;
  editing: boolean;
  editForm: ClinicalEditForm | null;
  onEdit?: (field: keyof ClinicalEditForm, value: string) => void;
  wide?: boolean;
  conduct?: boolean;
}) {
  const editValue = field && editForm ? editForm[field] : value;

  return (
    <article
      className={`prontuario-clinical-block${conduct ? ' prontuario-clinical-block--conduct' : ''}${wide ? '' : ' prontuario-clinical-block--half'}`}
    >
      <div className="prontuario-clinical-block__head">
        <h4 className="prontuario-clinical-block__title">{title}</h4>
      </div>
      {editing && field && onEdit ? (
        <textarea
          className="prontuario-clinical-block__textarea"
          value={editValue}
          onChange={(event) => onEdit(field, event.target.value)}
          rows={conduct ? 4 : 3}
        />
      ) : (
        <p className="prontuario-clinical-block__content">{value}</p>
      )}
    </article>
  );
}

export function ProntuarioOperacionalModal({
  atendimentoId,
  open,
  onClose,
  onCompleted,
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
    formatRecordId,
  } = prontuario;

  const eligible = atendimento?.elegibilidade?.eligible !== false;

  async function handleApprove() {
    if (editing && editForm) {
      const saved = await saveClinicalEdit();
      if (!saved) return;
    }
    const ok = await approveAttendance();
    if (ok) {
      onCompleted?.();
      onClose();
    }
  }

  async function handleReject() {
    const ok = await rejectAttendance();
    if (ok) {
      onCompleted?.();
      onClose();
    }
  }

  return createPortal(
    <div
      className="prontuario-modal-overlay"
      role="presentation"
      onClick={onClose}
      aria-hidden={false}
    >
      <div
        className="prontuario-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prontuario-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        {loading && !atendimento ? (
          <div className="prontuario-modal__loading">Carregando prontuário...</div>
        ) : null}

        {error && !atendimento ? (
          <div className="prontuario-modal__error">
            <p>{error}</p>
            <button type="button" className="prontuario-back-btn" onClick={onClose}>
              ← Voltar para painel
            </button>
          </div>
        ) : null}

        {atendimento && displayBlocks ? (
          <div className="prontuario-shell prontuario-shell--replica prontuario-shell--modal">
            <header className="prontuario-page-top">
              <button type="button" className="prontuario-back-btn" onClick={onClose}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Voltar para painel
              </button>
              <div className="prontuario-page-top__center">
                <h2 id="prontuario-modal-title" className="prontuario-page-title">
                  PRONTUÁRIO MÉDICO
                </h2>
                <p className="prontuario-page-subtitle">
                  Avalie as informações do paciente e aprove o atendimento
                </p>
              </div>
              <div className="prontuario-page-top__actions">
                <button
                  type="button"
                  className="prontuario-history-btn"
                  onClick={() => void viewAttachedPrescription()}
                  disabled={!hasAttachedPrescription}
                >
                  <span className="prontuario-history-btn__label">RECEITA ANEXADA</span>
                </button>
                <button
                  type="button"
                  className="prontuario-history-btn prontuario-history-btn--edit"
                  onClick={() => {
                    if (editing) {
                      cancelEditing();
                    } else {
                      startEditing();
                    }
                  }}
                >
                  <span className="prontuario-history-btn__label">{editing ? 'BLOQUEAR' : 'EDITAR'}</span>
                </button>
              </div>
            </header>

            <div className={`prontuario-eligibility prontuario-eligibility--${eligible ? 'ok' : 'warn'}`}>
              <span className="prontuario-eligibility__icon" aria-hidden="true">
                <Check className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="prontuario-eligibility__title">CRITÉRIOS DE ELEGIBILIDADE</p>
                <p className="prontuario-eligibility__message">{eligibilityMessage}</p>
              </div>
              <span className="prontuario-eligibility__badge">VERIFICADO</span>
            </div>

            {error ? (
              <div className="prontuario-modal__inline-error" role="alert">
                {error}
              </div>
            ) : null}

            <div className="prontuario-body">
              <div className="prontuario-main-grid">
                <section className="prontuario-patient-card">
                  <div className="prontuario-patient-card__head">
                    <h3 className="prontuario-patient-card__title">Dados do paciente</h3>
                  </div>
                  <div className="prontuario-patient-card__body">
                    <div className="prontuario-patient-card__hero">
                      <div className="prontuario-patient-card__avatar">{initials(atendimento.paciente_nome)}</div>
                      <div className="min-w-0">
                        <p className="prontuario-patient-card__name">{atendimento.paciente_nome}</p>
                        <p className="prontuario-patient-card__age">
                          {firstText(clinical.idade, clinical.age, '36 anos')}
                        </p>
                        <p className="prontuario-patient-card__record">
                          Prontuário: #
                          {String(clinical.prontuario_display || formatRecordId(atendimento.id))}
                        </p>
                        <p className="prontuario-patient-card__whatsapp">Contato via WhatsApp</p>
                      </div>
                    </div>
                    <dl className="prontuario-patient-card__rows">
                      {[
                        ['Data nascimento', firstText(clinical.data_nascimento, clinical.birth_date, '15/04/1988')],
                        ['CPF', atendimento.paciente_cpf || 'Não informado'],
                        ['E-mail', atendimento.paciente_email || 'Não informado'],
                        ['WhatsApp', atendimento.paciente_telefone || 'Não informado'],
                        ['Endereço', firstText(clinical.endereco, clinical.address)],
                        ['CEP', firstText(clinical.cep, clinical.postal_code)],
                      ].map(([label, value]) => (
                        <div key={label} className="prontuario-patient-card__row">
                          <dt className="prontuario-patient-card__label">{label}</dt>
                          <dd className="prontuario-patient-card__value">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </section>

                <section className="prontuario-history-card">
                  <div className="prontuario-history-card__head">
                    <h3 className="prontuario-history-card__title">História clínica</h3>
                  </div>
                  <div className="prontuario-history-card__body">
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
                    <div className="prontuario-clinical-pair">
                      <ClinicalBlock
                        title="ALERGIAS"
                        value={displayBlocks.alergias}
                        field="alergias"
                        editing={editing}
                        editForm={editForm}
                        onEdit={updateEditField}
                        wide={false}
                      />
                      <ClinicalBlock
                        title="MEDICAÇÕES EM USO"
                        value={displayBlocks.medicacao}
                        field="medicacao_em_uso"
                        editing={editing}
                        editForm={editForm}
                        onEdit={updateEditField}
                        wide={false}
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
                  </div>
                </section>
              </div>

              <ProntuarioDecisionBar
                notes={notes}
                onNotesChange={setNotes}
                onReject={() => void handleReject()}
                onApprove={() => void handleApprove()}
                disabled={actionLoading === 'save'}
                loadingAction={actionLoading === 'approve' ? 'approve' : actionLoading === 'reject' ? 'reject' : null}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
