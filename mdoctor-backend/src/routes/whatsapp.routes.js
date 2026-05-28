const express = require('express');
const eligibilityEngine = require('../eligibility/engine');
const logger = require('../config/logger');
const { createAuditLog } = require('../store/audit.store');
const { createPatient } = require('../store/patients.store');
const { STATUS, createAtendimento } = require('../store/atendimentos.store');

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

  if (configuredSecret) {
    if (!providedSecret || providedSecret !== configuredSecret) {
      logger.warn('whatsapp_webhook_unauthorized', {
        requestId,
        hasSecretConfigured: true,
        hasProvidedSecret: Boolean(providedSecret)
      });
      await createAuditLog({
        entity_type: 'whatsapp_webhook',
        action: 'webhook_unauthorized',
        actor: 'n8n',
        payload: {
          requestId,
          hasSecretConfigured: true,
          hasProvidedSecret: Boolean(providedSecret)
        }
      });
      return res.status(401).json({ success: false, error: 'Webhook não autorizado' });
    }
  } else if (process.env.NODE_ENV !== 'production') {
    logger.warn('whatsapp_webhook_secret_not_configured', {
      requestId,
      mode: 'dev_fallback_allowed'
    });
  }

  const { from, text = '', rawMessage } = req.body || {};
  if (!from) return res.status(400).json({ success: false, error: 'from obrigatório' });

  const patientData = {
    name: from,
    phone: from,
    condition: parseCondition(text),
    previous_prescription: /receita|renovar|uso continuo|uso contínuo/i.test(text),
    flags: parseFlags(text),
    notes: text,
    source: 'whatsapp',
    rawMessage
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
      from,
      eligible: decision.eligible,
      atendimento_id: atendimento.id
    }
  });

  return res.json({ success: true, reply, patient, atendimento, decision });
});

module.exports = router;
