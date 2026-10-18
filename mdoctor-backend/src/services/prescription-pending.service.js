const {
  STATUS,
  listAtendimentos,
  getAtendimento,
  updateAtendimentoStatus,
  listStatusHistory,
} = require('../store/atendimentos.store');
const { createAuditLog } = require('../store/audit.store');
const { refundRejectedAtendimento } = require('./stripe-refund.service');
const logger = require('../config/logger');

const PRESCRIPTION_UPLOAD_TIMEOUT_MS = Number(
  process.env.PRESCRIPTION_UPLOAD_TIMEOUT_MS || 12 * 60 * 60 * 1000,
);

const MANUAL_CANCEL_REASONS = Object.freeze({
  envio_nao_confirmado: 'Envio não confirmado',
  solicitacao_paciente: 'Solicitação do paciente',
  solicitacao_administrador: 'Solicitação do administrador',
  outro: 'Outro',
});

function isPaid(atendimento) {
  return String(atendimento?.pagamento_status || '').toUpperCase() === 'CONFIRMADO';
}

function isAwaitingPrescription(atendimento) {
  return String(atendimento?.status || '').toLowerCase() === STATUS.AWAITING_PRESCRIPTION_UPLOAD;
}

async function resolveWaitingSince(atendimento) {
  try {
    const history = await listStatusHistory(atendimento.id);
    const first = (history || []).find(
      (item) => String(item.status_novo || '').toLowerCase() === STATUS.AWAITING_PRESCRIPTION_UPLOAD,
    );
    if (first?.criado_em) return first.criado_em;
  } catch (error) {
    logger.warn('prescription_pending_history_lookup_failed', {
      appointmentId: atendimento.id,
      error: error.message,
    });
  }

  return (
    atendimento.dados_clinicos?.prescription_wait_started_at ||
    atendimento.dados_clinicos?.prescription_upload_session?.created_at ||
    atendimento.dados_clinicos?.stripe_paid_at ||
    atendimento.atualizado_em ||
    atendimento.criado_em ||
    null
  );
}

async function cancelAwaitingPrescription({
  atendimentoId,
  actor,
  source,
  reasonCode,
  reasonLabel,
  detail = null,
  now = new Date(),
}) {
  const atendimento = await getAtendimento(atendimentoId);
  if (!atendimento) {
    const error = new Error('Atendimento não encontrado');
    error.statusCode = 404;
    throw error;
  }
  if (!isAwaitingPrescription(atendimento)) {
    const error = new Error('Atendimento não está aguardando receita anterior');
    error.statusCode = 409;
    throw error;
  }

  const canceledAt = now.toISOString();
  let estorno = atendimento.dados_clinicos?.estorno || null;

  if (isPaid(atendimento)) {
    estorno = await refundRejectedAtendimento({
      atendimento,
      doctorId: actor || 'admin',
      correlationId: `prescription-cancel-${atendimento.id}`,
      refundReason: source === 'automatic_timeout' ? 'timeout_receita_anterior' : 'cancelamento_administrativo',
      idempotencyScope: 'prescription-cancel-refund',
    });
  }

  const notes = Array.isArray(atendimento.dados_clinicos?.observacoes_admin)
    ? atendimento.dados_clinicos.observacoes_admin
    : [];
  const resolvedNotes = notes.map((note) =>
    note.resolvido
      ? note
      : {
          ...note,
          resolvido: true,
          resolvido_em: canceledAt,
          resolvido_por: actor || source,
          resolucao: 'cancelamento_atendimento',
        },
  );

  const cancellation = {
    source,
    reason_code: reasonCode,
    reason_label: reasonLabel,
    detail: detail || null,
    canceled_at: canceledAt,
    canceled_by: actor || source,
    timeout_hours: source === 'automatic_timeout'
      ? Math.round(PRESCRIPTION_UPLOAD_TIMEOUT_MS / 3600000)
      : null,
    refund_status: estorno?.status || null,
    refund_id: estorno?.refund_id || null,
  };

  const updated = await updateAtendimentoStatus(atendimento.id, STATUS.REJECTED, {
    motivo: source === 'automatic_timeout'
      ? 'Cancelado automaticamente: prazo para envio da receita anterior expirado'
      : `Cancelamento administrativo: ${reasonLabel}`,
    medicoId: atendimento.medico_id,
    dados_clinicos: {
      ...(atendimento.dados_clinicos || {}),
      observacoes_admin: resolvedNotes,
      administrative_cancellation: cancellation,
      estorno,
    },
  });

  await createAuditLog({
    entity_type: 'atendimento',
    entity_id: atendimento.id,
    action: source === 'automatic_timeout'
      ? 'prescription_upload_timeout_cancelled'
      : 'admin_pending_cancelled',
    actor: actor || 'backend',
    payload: {
      reason_code: reasonCode,
      reason_label: reasonLabel,
      detail: detail || null,
      refund_status: estorno?.status || null,
      refund_id: estorno?.refund_id || null,
      timeout_ms: source === 'automatic_timeout' ? PRESCRIPTION_UPLOAD_TIMEOUT_MS : null,
    },
  });

  return { atendimento: updated, cancellation, estorno };
}

async function expireWaitingPrescriptionUploads({ now = new Date() } = {}) {
  const nowMs = now.getTime();
  const rows = await listAtendimentos();
  let cancelled = 0;

  for (const atendimento of rows) {
    if (!isAwaitingPrescription(atendimento)) continue;

    // eslint-disable-next-line no-await-in-loop
    const waitingSince = await resolveWaitingSince(atendimento);
    const waitingSinceMs = waitingSince ? new Date(waitingSince).getTime() : NaN;
    if (!Number.isFinite(waitingSinceMs)) continue;
    if (nowMs - waitingSinceMs < PRESCRIPTION_UPLOAD_TIMEOUT_MS) continue;

    try {
      // eslint-disable-next-line no-await-in-loop
      await cancelAwaitingPrescription({
        atendimentoId: atendimento.id,
        actor: 'system',
        source: 'automatic_timeout',
        reasonCode: 'timeout_12h',
        reasonLabel: 'Prazo de 12 horas expirado sem envio da receita anterior',
        now,
      });
      cancelled += 1;
    } catch (error) {
      logger.warn('prescription_upload_timeout_cancel_failed', {
        appointmentId: atendimento.id,
        error: error.message,
      });
    }
  }

  return { cancelled };
}

module.exports = {
  PRESCRIPTION_UPLOAD_TIMEOUT_MS,
  MANUAL_CANCEL_REASONS,
  isAwaitingPrescription,
  resolveWaitingSince,
  cancelAwaitingPrescription,
  expireWaitingPrescriptionUploads,
};