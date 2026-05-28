const express = require('express');
const eligibilityEngine = require('../eligibility/engine');
const logger = require('../config/logger');
const { createAuditLog } = require('../store/audit.store');
const { createPatient } = require('../store/patients.store');
const { STATUS, createAtendimento, getAtendimento, listAtendimentos } = require('../store/atendimentos.store');
const { getRememberedWebhookResult, rememberWebhookResult } = require('../store/webhook-idempotency.store');
const { getWhatsAppProviderStatus } = require('../delivery/delivery.service');
const {
  normalizeCondition,
  parseClinicalFlags,
  hasContinuousMedication,
  hasPreviousPrescription,
  extractUsageDays,
  buildClinicalNarrative,
  getRefusalMessage,
  PROTOCOL_VERSION
} = require('../services/clinical-intelligence.service');

const router = express.Router();

function parseCondition(text = '') {
  return normalizeCondition(text);
}

function parseFlags(text = '') {
  return parseClinicalFlags(text);
}

router.get('/status', (_req, res) => {
  res.json({
    success: true,
    enabled: process.env.WHATSAPP_ENABLED === 'true',
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development'
  });
});

router.get('/provider-status', async (_req, res) => {
  const requestId = _req.requestId || 'unknown';
  const correlationId = _req.correlationId || _req.get('X-Correlation-Id') || requestId;
  const providerStatus = await getWhatsAppProviderStatus();

  return res.json({
    success: true,
    correlationId,
    provider: providerStatus.provider,
    mode: providerStatus.mode,
    deliveryMockEnabled: providerStatus.deliveryMockEnabled,
    evolution: providerStatus.evolution
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
    const remembered = getRememberedWebhookResult(idempotencyKey);
    if (remembered?.atendimentoId) {
      const rememberedAtendimento = await getAtendimento(remembered.atendimentoId);
      if (rememberedAtendimento?.origem === 'whatsapp') {
        await createAuditLog({
          entity_type: 'whatsapp_webhook',
          entity_id: rememberedAtendimento.id,
          action: 'webhook_duplicate_ignored',
          actor: 'n8n',
          payload: {
            requestId,
            correlationId,
            from,
            idempotencyKey,
            source: 'memory_cache',
            atendimento_id: rememberedAtendimento.id
          }
        });

        return res.json({
          success: true,
          duplicate: true,
          idempotencyKey,
          correlationId,
          reply: remembered.reply || 'Solicitação já recebida anteriormente.',
          patient: null,
          atendimento: rememberedAtendimento,
          decision: remembered.decision || rememberedAtendimento.elegibilidade || null
        });
      }
    }

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
          source: 'persistent_lookup',
          atendimento_id: duplicated.id
        }
      });

      rememberWebhookResult(idempotencyKey, {
        atendimentoId: duplicated.id,
        decision: duplicated.elegibilidade || null,
        reply
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

  const originalPayload = rawMessage?.original && typeof rawMessage.original === 'object' ? rawMessage.original : {};
  const notesText = [text, originalPayload?.tempo_uso, originalPayload?.observacoes].filter(Boolean).join(' ');
  const baseFlags = parseFlags(notesText);
  const payloadFlags = Array.isArray(originalPayload?.flags) ? originalPayload.flags : [];
  const mergedFlags = [...new Set([...baseFlags, ...payloadFlags].map((flag) => String(flag || '').trim()).filter(Boolean))];

  const patientData = {
    name: from,
    phone: from,
    condition: parseCondition(text || originalPayload?.doenca_cronica || ''),
    previous_prescription: hasPreviousPrescription({
      previous_prescription: Boolean(originalPayload?.receita_anterior || originalPayload?.previous_prescription),
      notes: notesText,
      text
    }),
    continuous_use_proof: hasContinuousMedication({
      continuous_use_proof: Boolean(originalPayload?.uso_continuo || originalPayload?.continuous_use_proof),
      notes: notesText,
      text
    }),
    tempo_uso_dias: extractUsageDays({
      tempo_uso_dias: originalPayload?.tempo_uso_dias,
      tempo_uso: originalPayload?.tempo_uso,
      notes: notesText
    }),
    flags: mergedFlags,
    notes: text,
    source: 'whatsapp',
    rawMessage,
    idempotency_key: idempotencyKey || null,
    protocol_version: PROTOCOL_VERSION
  };

  const decision = eligibilityEngine.evaluate(patientData);
  const clinicalNarrative = buildClinicalNarrative({
    patientName: from,
    condition: patientData.condition,
    medication: originalPayload?.medicamento || originalPayload?.medicacao_em_uso || 'medicação em uso contínuo',
    decision
  });

  const enrichedClinicalData = {
    ...patientData,
    original_payload: originalPayload,
    protocol_version: PROTOCOL_VERSION,
    clinical_summary: clinicalNarrative.summary,
    queixa_principal: clinicalNarrative.chiefComplaint,
    historico_clinico: clinicalNarrative.clinicalHistory,
    exame_fisico_telemedicina: clinicalNarrative.teleExam,
    conduta_sugerida: clinicalNarrative.conduct,
    orientacoes_clinicas: clinicalNarrative.guidance,
    decision_meta: {
      reasonCode: decision.reasonCode || null,
      criteriaUsed: decision.criteriaUsed || [],
      riskLevel: decision.riskLevel || null,
      renewalStatus: decision.renewalStatus || null,
      protocolVersion: decision.protocolVersion || PROTOCOL_VERSION
    },
    clinical_audit: {
      correlationId,
      idempotencyKey: idempotencyKey || null,
      mode: 'mock',
      protocolVersion: decision.protocolVersion || PROTOCOL_VERSION
    }
  };

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
    dados_clinicos: enrichedClinicalData
  });

  const reply = decision.eligible
    ? 'Recebemos seus dados. Sua solicitação entrou na fila médica para análise.'
    : `Não foi possível seguir com renovação automática: ${decision.reason}. ${getRefusalMessage(decision.reasonCode)} `;

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
      atendimento_id: atendimento.id,
      criteriaUsed: decision.criteriaUsed || [],
      reasonCode: decision.reasonCode || null,
      protocolVersion: decision.protocolVersion || PROTOCOL_VERSION
    }
  });

  if (idempotencyKey) {
    rememberWebhookResult(idempotencyKey, {
      atendimentoId: atendimento.id,
      decision,
      reply
    });
  }

  return res.json({ success: true, correlationId, reply, patient, atendimento, decision });
});

module.exports = router;
