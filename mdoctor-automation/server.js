require('dotenv').config();

const express = require('express');
const {
  checkBackendHealth,
  forwardDecisionEvent,
  forwardWhatsAppWebhook,
  normalizeWhatsAppPayload
} = require('./services/backend-client');
const { requireWebhookSecret } = require('./services/security');

const app = express();
const PORT = Number(process.env.PORT || process.env.N8N_PORT || 5678);
const SERVICE_NAME = 'mdoctor-automation';
const startedAt = new Date();

const metrics = {
  whatsappReceived: 0,
  whatsappForwarded: 0,
  decisionReceived: 0,
  decisionForwarded: 0,
  failures: 0,
  lastWebhookAt: null,
  lastFailureAt: null
};

app.disable('x-powered-by');
app.use(express.json({ limit: process.env.JSON_LIMIT || '1mb', strict: false }));
app.use(express.urlencoded({ extended: true, limit: process.env.FORM_LIMIT || '1mb' }));

app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || `auto-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

function markFailure() {
  metrics.failures += 1;
  metrics.lastFailureAt = new Date().toISOString();
}

function readinessChecks() {
  const checks = {
    backendUrl: Boolean(process.env.BACKEND_URL),
    webhookSecret:
      process.env.NODE_ENV !== 'production' || Boolean(process.env.AUTOMATION_WEBHOOK_SECRET),
    nodeEnv: process.env.NODE_ENV || 'development'
  };

  return {
    status: Object.entries(checks)
      .filter(([key]) => key !== 'nodeEnv')
      .every(([, value]) => value)
      ? 'ok'
      : 'fail',
    checks
  };
}

app.get(['/health', '/healthz'], (_req, res) => {
  res.json({
    success: true,
    service: SERVICE_NAME,
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    startedAt: startedAt.toISOString()
  });
});

app.get('/metrics', requireWebhookSecret, (_req, res) => {
  res.json({
    success: true,
    service: SERVICE_NAME,
    metrics
  });
});

app.get('/readyz', async (_req, res) => {
  const local = readinessChecks();
  const backend = await checkBackendHealth();
  const status = local.status === 'ok' && backend.ok ? 'ok' : 'fail';

  res.status(status === 'ok' ? 200 : 503).json({
    success: status === 'ok',
    service: SERVICE_NAME,
    status,
    local,
    backend
  });
});

app.post('/webhook/whatsapp', requireWebhookSecret, async (req, res) => {
  metrics.whatsappReceived += 1;
  metrics.lastWebhookAt = new Date().toISOString();

  const payload = normalizeWhatsAppPayload(req.body || {});
  if (!payload.from || !payload.text) {
    return res.status(400).json({
      success: false,
      error: 'from e text sao obrigatorios'
    });
  }

  try {
    const result = await forwardWhatsAppWebhook(payload, req.requestId);
    metrics.whatsappForwarded += 1;
    return res.status(result.status).json(result.data);
  } catch (error) {
    markFailure();
    return res.status(error.statusCode || 502).json({
      success: false,
      error: 'Falha ao encaminhar WhatsApp para backend',
      details: error.message,
      requestId: req.requestId
    });
  }
});

app.post('/webhook/decisao', requireWebhookSecret, async (req, res) => {
  metrics.decisionReceived += 1;
  metrics.lastWebhookAt = new Date().toISOString();

  const event = req.body || {};
  if (!event.atendimentoId && !event.atendimento_id && !event.id) {
    return res.status(400).json({
      success: false,
      error: 'atendimentoId e obrigatorio'
    });
  }

  try {
    const result = await forwardDecisionEvent(event, req.requestId);
    metrics.decisionForwarded += result.forwarded ? 1 : 0;
    return res.status(result.status).json(result.data);
  } catch (error) {
    markFailure();
    return res.status(error.statusCode || 502).json({
      success: false,
      error: 'Falha ao processar evento de decisao',
      details: error.message,
      requestId: req.requestId
    });
  }
});

app.post('/webhook/test', requireWebhookSecret, (req, res) => {
  res.json({
    success: true,
    service: SERVICE_NAME,
    requestId: req.requestId,
    received: req.body || {}
  });
});

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: 'Rota nao encontrada'
  });
});

app.use((error, req, res, _next) => {
  markFailure();
  res.status(error.status || 500).json({
    success: false,
    error: 'Erro interno do automation',
    details: process.env.NODE_ENV === 'production' ? undefined : error.message,
    requestId: req.requestId
  });
});

app.listen(PORT, () => {
  console.log(`[${SERVICE_NAME}] online na porta ${PORT}`);
});
