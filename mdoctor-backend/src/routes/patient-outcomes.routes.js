const express = require('express');
const logger = require('../config/logger');
const { verifyN8nWebhookSecret } = require('../middlewares/n8n-webhook-auth');
const { requireIngressOrAuth } = require('../middlewares/ingress-service-auth');
const { upsertOutcome, getOutcomeByAttendance } = require('../store/patient-outcomes.store');
const { handleSurveyInbound, triggerPostDeliverySurvey } = require('../services/post-delivery-survey.service');
const { SURVEY_VERSION } = require('../constants/patient-outcome-survey');

const router = express.Router();

router.post('/upsert', requireIngressOrAuth, async (req, res) => {
  const correlationId = req.correlationId || req.get('X-Correlation-Id') || req.requestId || 'unknown';
  try {
    const outcome = await upsertOutcome(req.body || {});
    return res.json({ success: true, correlationId, outcome });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      correlationId,
      error: error.message,
      code: error.code || 'PATIENT_OUTCOME_UPSERT_FAILED'
    });
  }
});

router.post('/survey/inbound', async (req, res) => {
  const auth = verifyN8nWebhookSecret(req);
  if (!auth.ok) return res.status(auth.status).json(auth.body);

  const correlationId = auth.correlationId;
  const { from, phone, text } = req.body || {};
  const resolvedPhone = from || phone;

  try {
    const result = await handleSurveyInbound({
      phone: resolvedPhone,
      text,
      correlationId
    });
    return res.json({ success: true, correlationId, ...result });
  } catch (error) {
    logger.error('patient_outcome_survey_inbound_failed', {
      correlationId,
      error: error.message
    });
    return res.status(500).json({
      success: false,
      correlationId,
      handled: false,
      error: error.message
    });
  }
});

router.post('/survey/trigger', requireIngressOrAuth, async (req, res) => {
  const correlationId = req.correlationId || req.get('X-Correlation-Id') || req.requestId || 'unknown';
  const { attendance_id, patient_id, phone } = req.body || {};
  if (!attendance_id || !phone) {
    return res.status(400).json({
      success: false,
      correlationId,
      error: 'attendance_id e phone são obrigatórios'
    });
  }

  try {
    const result = await triggerPostDeliverySurvey({
      attendanceId: attendance_id,
      patientId: patient_id || null,
      phone,
      correlationId
    });
    return res.json({ success: true, correlationId, ...result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      correlationId,
      error: error.message
    });
  }
});

router.get('/:attendanceId', requireIngressOrAuth, async (req, res) => {
  const correlationId = req.correlationId || req.get('X-Correlation-Id') || req.requestId || 'unknown';
  const surveyVersion = req.query.survey_version || SURVEY_VERSION;
  const outcome = await getOutcomeByAttendance(req.params.attendanceId, surveyVersion);
  if (!outcome) {
    return res.status(404).json({ success: false, correlationId, error: 'Registro não encontrado' });
  }
  return res.json({ success: true, correlationId, outcome });
});

module.exports = router;
