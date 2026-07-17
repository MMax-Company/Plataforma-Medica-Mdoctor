const assert = require('assert');

function getMedicalQueueEnteredAt(item) {
  const clinical = item.dados_clinicos || {};
  const explicit = String(clinical.medical_queue_entered_at || '').trim();
  if (explicit) return explicit;

  const uploadSession = clinical.prescription_upload_session || {};
  const candidates = [
    uploadSession.completed_at,
    clinical.previous_prescription_uploaded_at,
    item.atualizado_em,
    item.criado_em,
  ];
  for (const value of candidates) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return undefined;
}

function formatMedicalWaitingTime(item, nowMs = Date.now()) {
  const enteredAt = getMedicalQueueEnteredAt(item);
  if (!enteredAt) return 'Agora';
  const diff = Math.max(0, nowMs - new Date(enteredAt).getTime());
  const hours = Math.floor(diff / 36e5);
  const minutes = Math.floor((diff % 36e5) / 6e4);
  return hours ? `${hours}h ${minutes}min` : `${minutes || 1}min`;
}

const withUploadComplete = {
  criado_em: '2026-07-17T16:38:54.062+00:00',
  atualizado_em: '2026-07-17T16:51:27.647567+00:00',
  dados_clinicos: {
    prescription_upload_session: { completed_at: '2026-07-17T16:51:27.577Z' },
    previous_prescription_uploaded_at: '2026-07-17T16:51:27.426Z',
  },
};

const a8704590 = {
  criado_em: '2026-07-17T16:38:54.062+00:00',
  atualizado_em: '2026-07-17T16:51:27.647567+00:00',
  dados_clinicos: {
    medical_queue_entered_at: '2026-07-17T17:50:37.886Z',
    prescription_upload_session: { completed_at: '2026-07-17T16:51:27.577Z' },
    previous_prescription_uploaded_at: '2026-07-17T16:51:27.426Z',
  },
};

const now = new Date('2026-07-17T18:06:00.000Z').getTime();
assert.equal(getMedicalQueueEnteredAt(withUploadComplete), '2026-07-17T16:51:27.577Z');
assert.equal(getMedicalQueueEnteredAt(a8704590), '2026-07-17T17:50:37.886Z');
assert.equal(formatMedicalWaitingTime({ criado_em: withUploadComplete.criado_em, dados_clinicos: {} }, now), '1h 27min');
assert.equal(formatMedicalWaitingTime(withUploadComplete, now), '1h 14min');
assert.equal(formatMedicalWaitingTime(a8704590, now), '15min');

console.log(JSON.stringify({
  medicalQueueWaitingTime: 'ok',
  a8704590_timestamp: getMedicalQueueEnteredAt(a8704590),
  a8704590_display: formatMedicalWaitingTime(a8704590, now),
}));
