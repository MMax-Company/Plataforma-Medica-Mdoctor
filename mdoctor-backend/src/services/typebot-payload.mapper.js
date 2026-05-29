const {
  normalizeTypebotPayload,
  toPatientEvaluationShape,
  buildCleanBackendPayload,
  INELIGIBLE_USER_MESSAGE
} = require('./clinical-payload-normalizer.service');

function mapTypebotPayload(body = {}) {
  const { original, normalized } = normalizeTypebotPayload(body);
  const patientData = {
    ...toPatientEvaluationShape(normalized),
    typebot_variables: buildCleanBackendPayload(normalized),
    notes: body.text || original.text || null
  };

  return { original, patientData, normalized, INELIGIBLE_USER_MESSAGE };
}

module.exports = {
  mapTypebotPayload,
  INELIGIBLE_USER_MESSAGE,
  normalizeTypebotPayload,
  buildCleanBackendPayload
};
