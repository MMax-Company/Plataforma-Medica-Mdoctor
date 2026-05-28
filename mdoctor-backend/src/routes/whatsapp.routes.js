const express = require('express');
const eligibilityEngine = require('../eligibility/engine');
const logger = require('../config/logger');
const { createAuditLog } = require('../store/audit.store');
const { createPatient } = require('../store/patients.store');
const { STATUS, createAtendimento, listAtendimentos } = require('../store/atendimentos.store');

const router = express.Router();

function parseCondition(text = '') {
  const normalized = text.toLowerCase();
  if (normalized.includes('diabetes')) return 'diabetes_tipo_2';
  if (normalized.includes('colesterol') || normalized.includes('dislipidemia')) return 'dislipidemia';
  if (normalized.includes('tireoide') || normalized.includes('hipotireoidismo')) return 'hipotireoidismo';
  if (normalized.includes('pressao') || normalized.includes('pressão') || normalized.includes('hipertens')) return 'hipertensao';
  return 'renovacao_receita';
}

function parseFlags(text = '') {
  const normalized = text.toLowerCase();
  const flags = [];
  if (normalized.includes('sintoma novo')) flags.push('sintomas_novos');
  if (normalized.includes('intern')) flags.push('internacao_recente');
  if (normalized.includes('crise')) flags.push('crise_clinica');
  if (normalized.includes('urg')) flags.push('sinais_urgencia');
  return flags;
}

router.get('/status', (_req, res) => {
  res.json({
    success: true,
    enabled: process.env.WHATSAPP_ENABLED === 'true',
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development'
  });
});

router.post('/webhook', async (req, res) => {
  const configuredSecret = String(process.env.N8N_WEBHOOK_SECRET || '').trim();
  const providedSecret = String(req.get('X-MDoctor-Webhook-Secret') || '').trim();
  const requestId = req.requestId || 'unknown';
  const correlationId = req.correlationId || req.get('X-Correlation-Id') || requestId;

  if (configuredSecret) {
    if (!providedSecret || providedSecret !== configuredSecret) {
      logger.warn('whatsapp_webhook_unauthorized', {
        requestId,
        correlationId,
        hasSecretConfigured: true,
        hasProvidedSecret: Boolean(providedSecret)
      });
      await createAuditLog({
        entity_type: 'whatsapp_webhook',
        action: 'webhook_unauthorized',
        actor: 'n8n',
        payload: {
          requestId,
          correlationId,
          hasSecretConfigured: true,
          hasProvidedSecret: Boolean(providedSecret)
        }
      });
      return res.status(401).json({ success: false, error: 'Webhook não autorizado', correlationId });
    }
  } else if (process.env.NODE_ENV !== 'production') {
    logger.warn('whatsapp_webhook_secret_not_configured', {
      requestId,
      correlationId,
      mode: 'dev_fallback_allowed'
    });
  }

  const { from, text = '', rawMessage } = req.body || {};
  const headerIdempotencyKey = String(req.get('Idempotency-Key') || '').trim();
  const payloadMessageId = String(rawMessage?.messageId || req.body?.messageId || '').trim();
  const idempotencyKey = headerIdempotencyKey || payloadMessageId;

  if (!from) return res.status(400).json({ success: false, error: 'from obrigatório', correlationId });

  if (idempotencyKey) {
    const history = await listAtendimentos();
    const duplicated = history.find((item) => {
      if (item?.origem !== 'whatsapp') return false;
      const itemClinical = item?.dados_clinicos || {};
      const itemRawMessage = itemClinical.rawMessage || {};
      const storedKey = String(itemClinical.idempotency_key || '').trim();
      const storedMessageId = String(itemRawMessage.messageId || '').trim();
      return storedKey === idempotencyKey || storedMessageId === idempotencyKey;
    });

    if (duplicated) {
      const reply = duplicated.elegibilidade?.eligible
        ? 'Recebemos seus dados. Sua solicitação entrou na fila médica para análise.'
        : `Não foi possível seguir com renovação automática: ${duplicated.elegibilidade?.reason || 'Solicitação inelegível'}. Procure atendimento médico.`;

      await createAuditLog({
        entity_type: 'whatsapp_webhook',
        entity_id: duplicated.id,
        action: 'webhook_duplicate_ignored',
        actor: 'n8n',
        payload: {
          requestId,
          correlationId,
          from,
          idempotencyKey,
          atendimento_id: duplicated.id
        }
      });

      return res.json({
        success: true,
        duplicate: true,
        idempotencyKey,
        correlationId,
        reply,
        patient: null,
        atendimento: duplicated,
        decision: duplicated.elegibilidade || null
      });
    }
  }

  const patientData = {
    name: from,
    phone: from,
    condition: parseCondition(text),
    previous_prescription: /receita|renovar|uso continuo|uso contínuo/i.test(text),
    flags: parseFlags(text),
    notes: text,
    source: 'whatsapp',
    rawMessage,
    idempotency_key: idempotencyKey || null
  };

  const decision = eligibilityEngine.evaluate(patientData);
  const patient = await createPatient({
    ...patientData,
    status: decision.eligible ? 'pending' : 'rejected'
  });
  const atendimento = await createAtendimento({
    ...patientData,
    paciente_nome: from,
    paciente_telefone: from,
    status: decision.eligible ? STATUS.QUEUE : STATUS.REJECTED,
    risco: decision.eligible ? 'BAIXO' : 'BLOQUEADO',
    elegibilidade: decision,
    dados_clinicos: patientData
  });

  const reply = decision.eligible
    ? 'Recebemos seus dados. Sua solicitação entrou na fila médica para análise.'
    : `Não foi possível seguir com renovação automática: ${decision.reason}. Procure atendimento médico.`;

  await createAuditLog({
    entity_type: 'whatsapp_webhook',
    entity_id: atendimento.id,
    action: 'webhook_processed',
    actor: 'n8n',
    payload: {
      requestId,
      correlationId,
      from,
      idempotencyKey: idempotencyKey || null,
      eligible: decision.eligible,
      atendimento_id: atendimento.id
    }
  });

  return res.json({ success: true, correlationId, reply, patient, atendimento, decision });
});

module.exports = router;
