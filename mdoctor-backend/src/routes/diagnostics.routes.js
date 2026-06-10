/**
 * Diagnóstico Memed — staging apenas.
 * Recebe e armazena logs automáticos de falha em setPaciente.
 * Ativo quando ENVIRONMENT_NAME=staging ou DIAGNOSTICS_ENABLED=true.
 * NÃO habilitar em production.
 */
const express = require('express');
const router = express.Router();
const logger = require('../config/logger');

function isEnabled() {
  if (process.env.DIAGNOSTICS_ENABLED === 'true') return true;
  if (process.env.ENVIRONMENT_NAME === 'staging') return true;
  return false;
}

const MAX_REPORTS = 30;
const reports = [];

router.post('/memed', (req, res) => {
  if (!isEnabled()) return res.status(404).json({ error: 'Not found' });

  const report = {
    receivedAt: new Date().toISOString(),
    atendimentoId: req.body?.atendimentoId || null,
    patientName: req.body?.patientName || null,
    timestamp: req.body?.timestamp || null,
    error: req.body?.error || null,
    log: Array.isArray(req.body?.log) ? req.body.log : [],
  };

  reports.unshift(report);
  if (reports.length > MAX_REPORTS) reports.splice(MAX_REPORTS);

  logger.info('memed_diagnostic_report_received', {
    atendimentoId: report.atendimentoId,
    error: report.error,
    logEntries: report.log.length,
  });

  return res.json({ ok: true, stored: reports.length });
});

router.get('/memed', (req, res) => {
  if (!isEnabled()) return res.status(404).json({ error: 'Not found' });
  return res.json({ count: reports.length, reports });
});

module.exports = router;
