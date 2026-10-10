// Chat Administrativo de Suporte V1 — ETAPA 2 (rotas).
// Montado isoladamente em /api/admin/support (ver server.js) — não altera
// admin.routes.js nem nenhuma rota clínica/WhatsApp existente. Toda rota
// exige requireAuth + requireRole(...SUPPORT_CHAT_ROLES); sem isso, médico
// ou qualquer papel não-administrativo recebe 403, e requisição sem token
// recebe 401 — nunca chega ao service.
const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const logger = require('../config/logger');
const service = require('../services/support-chat.service');
const { SUPPORT_CHAT_ROLES } = require('../constants/support-chat');

const router = express.Router();

router.use(requireAuth, requireRole(...SUPPORT_CHAT_ROLES));

// Master switch: com SUPPORT_CHAT_ENABLED e/ou SUPPORT_CHAT_READ_ENABLED
// desligados (padrão), nenhuma rota abaixo expõe dado ou aceita ação —
// responde 503 de forma explícita, sem tentar ler o banco.
function requireReadAvailable(req, res, next) {
  if (!service.isReadAvailable()) {
    return res.status(503).json({
      success: false,
      error: 'Chat administrativo de suporte desativado nesta etapa',
      code: 'SUPPORT_CHAT_DISABLED'
    });
  }
  return next();
}

router.get('/conversations', requireReadAvailable, async (req, res) => {
  const correlationId = req.correlationId || req.requestId || 'unknown';
  try {
    const conversations = await service.listQueue();
    return res.json({ success: true, correlationId, conversations });
  } catch (error) {
    logger.error('support_chat_list_queue_failed', { correlationId, error: error.message });
    return res.status(500).json({ success: false, correlationId, error: error.message });
  }
});

router.get('/conversations/:id', requireReadAvailable, async (req, res) => {
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

router.post('/conversations/:id/claim', requireReadAvailable, async (req, res) => {
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

router.post('/conversations/:id/release', requireReadAvailable, async (req, res) => {
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

router.post('/conversations/:id/close', requireReadAvailable, async (req, res) => {
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
