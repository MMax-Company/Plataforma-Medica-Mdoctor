const QUEUE_TYPE_MEDICAL = 'medical';
const QUEUE_TYPE_SUPPORT = 'support';
// Atendimento clínico real (chatbot) temporariamente encaminhado pelo suporte
// administrativo para esclarecimento médico pontual — ver
// admin.routes.js (forward-to-doctor) e atendimentos.routes.js (medical-support/*).
const QUEUE_TYPE_MEDICAL_SUPPORT = 'medical_support';

function getQueueType(atendimento = {}) {
  const clinical = atendimento.dados_clinicos || {};
  if (clinical.queue_type === QUEUE_TYPE_MEDICAL_SUPPORT) {
    return QUEUE_TYPE_MEDICAL_SUPPORT;
  }
  if (clinical.queue_type === QUEUE_TYPE_SUPPORT || clinical.whatsapp_support === true) {
    return QUEUE_TYPE_SUPPORT;
  }
  if (atendimento.condicao === 'suporte_whatsapp') {
    return QUEUE_TYPE_SUPPORT;
  }
  return QUEUE_TYPE_MEDICAL;
}

function isSupportQueue(atendimento = {}) {
  return getQueueType(atendimento) === QUEUE_TYPE_SUPPORT;
}

function isMedicalQueue(atendimento = {}) {
  return getQueueType(atendimento) === QUEUE_TYPE_MEDICAL;
}

function isMedicalSupportQueue(atendimento = {}) {
  return getQueueType(atendimento) === QUEUE_TYPE_MEDICAL_SUPPORT;
}

module.exports = {
  QUEUE_TYPE_MEDICAL,
  QUEUE_TYPE_SUPPORT,
  QUEUE_TYPE_MEDICAL_SUPPORT,
  getQueueType,
  isSupportQueue,
  isMedicalQueue,
  isMedicalSupportQueue
};
