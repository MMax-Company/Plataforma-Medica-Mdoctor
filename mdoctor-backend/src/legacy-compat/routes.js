const express = require('express');
const { requireLegacyFlag } = require('./feature-flags');
const { legacyLog } = require('./middlewares/legacy-log');
const { normalizeLegacyWhatsApp } = require('./adapters/whatsapp.adapter');
const { adaptLegacyFilaResponse } = require('./adapters/panel.adapter');

const whatsappRoutes = require('../routes/whatsapp.routes');
const atendimentosRoutes = require('../routes/atendimentos.routes');
const memedRoutes = require('../routes/memed.routes');

const router = express.Router();

function proxyTo(targetRouter, targetUrl) {
  return (req, res, next) => {
    const previousUrl = req.url;
    req.url = targetUrl;
    targetRouter.handle(req, res, (error) => {
      req.url = previousUrl;
      return next(error);
    });
  };
}

router.get(
  '/healthz',
  requireLegacyFlag(),
  legacyLog({
    integration: 'railway',
    legacyEndpoint: '/healthz',
    mappedEndpoint: '/healthz',
    mode: 'coexist'
  }),
  (_req, res) => {
    res.json({
      status: 'OK',
      service: 'Backend-MDoctor',
      legacyCompat: true,
      timestamp: new Date().toISOString()
    });
  }
);

router.post(
  '/webhook/whatsapp',
  requireLegacyFlag('whatsapp'),
  legacyLog({
    integration: 'whatsapp',
    legacyEndpoint: '/webhook/whatsapp',
    mappedEndpoint: '/api/whatsapp/webhook',
    mode: 'adapter'
  }),
  normalizeLegacyWhatsApp,
  proxyTo(whatsappRoutes, '/webhook')
);

router.get(
  '/memed/token',
  requireLegacyFlag('memed'),
  legacyLog({
    integration: 'memed',
    legacyEndpoint: '/memed/token',
    mappedEndpoint: '/api/memed/token',
    mode: 'proxy'
  }),
  proxyTo(memedRoutes, '/token')
);

router.get(
  ['/fila', '/api/fila'],
  requireLegacyFlag('panel'),
  legacyLog({
    integration: 'panel',
    legacyEndpoint: '/fila|/api/fila',
    mappedEndpoint: '/api/atendimentos/queue',
    mode: 'adapter'
  }),
  adaptLegacyFilaResponse,
  proxyTo(atendimentosRoutes, '/queue')
);

module.exports = router;
