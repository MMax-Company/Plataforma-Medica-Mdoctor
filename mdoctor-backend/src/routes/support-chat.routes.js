// Chat Administrativo de Suporte V1 — ETAPA 2 (rotas) + envio humano
// (ETAPA 2 — envio). Montado isoladamente em /api/admin/support (ver
// server.js) — não altera admin.routes.js nem nenhuma rota clínica/WhatsApp
// existente. Toda rota exige requireAuth + requireRole(...SUPPORT_CHAT_ROLES);
// sem isso, médico ou qualquer papel não-administrativo recebe 403, e
// requisição sem token recebe 401 — nunca chega ao service. A rota de envio
// (POST /conversations/:id/messages) exige adicionalmente
// SUPPORT_CHAT_AGENT_SEND_ENABLED=true (503 explícito enquanto desligada).
const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const logger = require('../config/logger');
const service = require('../services/support-chat.service');
const { SUPPORT_CHAT_ROLES } = require('../constants/support-chat');

const router = express.Router();

router.use(requireAuth, requireRole(...SUPPORT_CHAT_ROLES));

// Com SUPPORT_CHAT_UI_ENABLED desligada (padrão), nenhuma rota abaixo expõe
// dado ou aceita ação — responde 503 de forma explícita, sem tentar ler o
// banco. Flag independente de SUPPORT_CHAT_CAPTURE_ENABLED (gravação de
// inbound) e SUPPORT_CHAT_AGENT_SEND_ENABLED (envio humano futuro).
function requireUiAvailable(req, res, next) {
  if (!service.isUiAvailable()) {
    return res.status(503).json({
      success: false,
      error: 'Chat administrativo de suporte desativado nesta etapa',
      code: 'SUPPORT_CHAT_DISABLED'
    });
  }
  return next();
}

router.get('/conversations', requireUiAvailable, async (req, res) => {
  const correlationId = req.correlationId || req.requestId || 'unknown';
  try {
    const conversations = await service.listQueue();
    return res.json({ success: true, correlationId, conversations });
  } catch (error) {
    logger.error('support_chat_list_queue_failed', { correlationId, error: error.message });
    return res.status(500).json({ success: false, correlationId, error: error.message });
  }
});

router.get('/conversations/:id', requireUiAvailable, async (req, res) => {
  const correlationId = req.correlationId || req.requestId || 'unknown';
  try {
    const result = await service.getConversationWithMessages(req.params.id);
    if (!result) {
      return res.status(404).json({ success: false, correlationId, error: 'Conversation não encontrada' });
    }
    return res.json({ success: true, correlationId, ...result });
  } catch (error) {
    logger.error('support_chat_get_conversation_failed', { correlationId, error: error.message });
    return res.status(500).json({ success: false, correlationId, error: error.message });
  }
});

router.post('/conversations/:id/claim', requireUiAvailable, async (req, res) => {
  const correlationId = req.correlationId || req.requestId || 'unknown';
  const actorId = req.user?.sub || req.user?.username || req.user?.role;
  try {
    const result = await service.claim({ conversationId: req.params.id, actorId });
    if (!result.claimed) {
      return res.status(409).json({ success: false, correlationId, reason: result.reason, conversation: result.conversation });
    }
    return res.json({ success: true, correlationId, conversation: result.conversation });
  } catch (error) {
    logger.error('support_chat_claim_failed', { correlationId, error: error.message });
    return res.status(error.statusCode || 500).json({ success: false, correlationId, error: error.message });
  }
});

router.post('/conversations/:id/release', requireUiAvailable, async (req, res) => {
  const correlationId = req.correlationId || req.requestId || 'unknown';
  const actorId = req.user?.sub || req.user?.username || req.user?.role;
  try {
    const result = await service.release({ conversationId: req.params.id, actorId });
    if (!result.released) {
      return res.status(409).json({ success: false, correlationId, conversation: result.conversation });
    }
    return res.json({ success: true, correlationId, conversation: result.conversation });
  } catch (error) {
    logger.error('support_chat_release_failed', { correlationId, error: error.message });
    return res.status(error.statusCode || 500).json({ success: false, correlationId, error: error.message });
  }
});

// Renovação do lock (heartbeat): mesma validação de posse do claim/release
// (só o dono atual renova). Chamada periodicamente pelo frontend enquanto a
// conversation está com o lock sob posse, para o lease de 2 minutos
// (DEFAULT_LOCK_LEASE_MS) nunca expirar silenciosamente durante um
// atendimento mais longo.
router.post('/conversations/:id/heartbeat', requireUiAvailable, async (req, res) => {
  const correlationId = req.correlationId || req.requestId || 'unknown';
  const actorId = req.user?.sub || req.user?.username || req.user?.role;
  try {
    const result = await service.heartbeat({ conversationId: req.params.id, actorId });
    if (!result.renewed) {
      return res.status(409).json({ success: false, correlationId, conversation: result.conversation });
    }
    return res.json({ success: true, correlationId, conversation: result.conversation });
  } catch (error) {
    logger.error('support_chat_heartbeat_failed', { correlationId, error: error.message });
    return res.status(error.statusCode || 500).json({ success: false, correlationId, error: error.message });
  }
});

// Com SUPPORT_CHAT_AGENT_SEND_ENABLED desligada (padrão), a rota de envio
// humano responde 503 explícito sem validar lock/janela/provider — flag
// independente de SUPPORT_CHAT_UI_ENABLED (acima) e SUPPORT_CHAT_CAPTURE_ENABLED.
function requireAgentSendAvailable(req, res, next) {
  if (!service.isAgentSendAvailable()) {
    return res.status(503).json({
      success: false,
      error: 'Envio humano do chat administrativo desativado nesta etapa',
      code: 'SUPPORT_CHAT_AGENT_SEND_DISABLED'
    });
  }
  return next();
}

router.post('/conversations/:id/messages', requireUiAvailable, requireAgentSendAvailable, async (req, res) => {
  const correlationId = req.correlationId || req.requestId || 'unknown';
  const actorId = req.user?.sub || req.user?.username || req.user?.role;
  const { text, clientMessageId } = req.body || {};

  if (!text || !String(text).trim()) {
    return res.status(400).json({ success: false, correlationId, error: 'Campo "text" é obrigatório' });
  }
  if (!clientMessageId || !String(clientMessageId).trim()) {
    return res.status(400).json({ success: false, correlationId, error: 'Campo "clientMessageId" é obrigatório' });
  }

  try {
    const result = await service.sendHumanMessage({
      conversationId: req.params.id,
      actorId,
      text,
      clientMessageId
    });

    if (!result.sent) {
      const statusByReason = {
        not_found: 404,
        closed: 409,
        not_locked: 409,
        lock_expired: 409,
        window_expired: 409,
        send_in_progress: 409,
        missing_patient_phone: 422
      };
      return res.status(statusByReason[result.reason] || 409).json({
        success: false,
        correlationId,
        reason: result.reason,
        windowStatus: result.windowStatus || null,
        conversation: result.conversation || null
      });
    }

    return res.json({
      success: true,
      correlationId,
      duplicate: Boolean(result.duplicate),
      message: result.message,
      conversation: result.conversation
    });
  } catch (error) {
    logger.error('support_chat_send_message_failed', { correlationId, error: error.message, code: error.code });
    return res.status(error.statusCode || 500).json({
      success: false,
      correlationId,
      error: error.message,
      code: error.code || null
    });
  }
});

router.post('/conversations/:id/close', requireUiAvailable, async (req, res) => {
  const correlationId = req.correlationId || req.requestId || 'unknown';
  const actorId = req.user?.sub || req.user?.username || req.user?.role;
  try {
    const result = await service.close({ conversationId: req.params.id, actorId });
    if (!result.closed) {
      return res.status(409).json({ success: false, correlationId, conversation: result.conversation });
    }
    return res.json({ success: true, correlationId, conversation: result.conversation });
  } catch (error) {
    logger.error('support_chat_close_failed', { correlationId, error: error.message });
    return res.status(error.statusCode || 500).json({ success: false, correlationId, error: error.message });
  }
});

module.exports = router;
