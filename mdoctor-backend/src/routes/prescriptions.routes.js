const express = require('express');
const memed = require('../services/memed.service');
const { requireAuth } = require('../auth/auth.middleware');
const { createAuditLog } = require('../store/audit.store');
const { getPrescriptionByAtendimento } = require('../store/prescriptions.store');
const { allowMemedMockFallback, isMemedRealEnabled } = require('../config/memed-runtime');

const router = express.Router();

/** Fluxo oficial de emissão: widget Memed/Sinapse → prescricaoImpressa → POST /api/memed/receita */
const OFFICIAL_MEMED_FLOW = {
  success: false,
  code: 'PRESCRIPTION_REST_DEPRECATED',
  error:
    'Emissão via REST /api/prescriptions não é fluxo oficial. Use widget Memed/Sinapse no painel e POST /api/memed/receita após confirmação do médico.',
  officialFlow: [
    'POST /api/memed/iniciar-emissao',
    'widget Sinapse (painel /receita)',
    'POST /api/memed/receita'
  ]
};

function rejectDeprecatedEmission(res) {
  res.setHeader('X-Deprecated-Endpoint', 'true');
  res.setHeader('X-Official-Flow', 'memed-widget-sinapse');
  return res.status(410).json(OFFICIAL_MEMED_FLOW);
}

function buildMockPrescription(id, payload = {}) {
  const now = new Date().toISOString();
  return {
    id: String(id || `mock-${Date.now()}`),
    mode: 'mock',
    medication: payload.medication || payload.medicamento || 'Medicamento conforme avaliação médica',
    dosage: payload.dosage || 'Conforme posologia definida pelo médico',
    instructions:
      payload.instructions ||
      payload.orientacoes ||
      'Receita simulada para continuidade do MVP. Integração Memed real ainda indisponível.',
    duration: payload.duration || payload.duracao || '30 dias',
    issuedBy: payload.issuedBy || process.env.MEDICO_NOME || 'Médico responsável',
    createdAt: now,
    pdfUrl: `/api/prescriptions/${encodeURIComponent(String(id || 'mock'))}/pdf`
  };
}

function mockPrescriptionResponse(id, warning, payload) {
  return {
    success: true,
    source: 'mock',
    data: buildMockPrescription(id, payload),
    mode: 'mock',
    warning: warning || 'Memed real indisponível. Exibindo receita simulada.'
  };
}

function toResponseFromStored(stored) {
  return {
    success: true,
    source: stored.provider === 'memed' ? 'memed' : 'mock',
    data: {
      id: stored.id,
      mode: stored.provider || 'stored',
      medication: Array.isArray(stored.medications) && stored.medications.length ? stored.medications.join(', ') : 'Medicamento conforme avaliação médica',
      dosage: stored.payload?.dosage || 'Conforme posologia definida pelo médico',
      instructions: stored.payload?.instructions || 'Receita recuperada do armazenamento do backend.',
      duration: stored.payload?.duration || '30 dias',
      issuedBy: stored.payload?.issuedBy || process.env.MEDICO_NOME || 'Médico responsável',
      createdAt: stored.created_at,
      pdfUrl: stored.pdf_url || `/api/prescriptions/${stored.id}/pdf`,
      stored
    },
    mode: stored.provider || 'stored'
  };
}

function mockPdfBuffer(id) {
  const content = `Receita gerada em modo desenvolvimento\nID: ${id}\n`;
  return Buffer.from(
    `%PDF-1.1\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n` +
      `2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n` +
      `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R >> endobj\n` +
      `4 0 obj << /Length ${content.length + 42} >> stream\nBT /F1 12 Tf 20 100 Td (${content.replace(/\n/g, ' ')}) Tj ET\nendstream endobj\n` +
      `trailer << /Root 1 0 R >>\n%%EOF`
  );
}

router.post('/', requireAuth, (req, res) => rejectDeprecatedEmission(res));

router.post('/:id/generate', requireAuth, (req, res) => rejectDeprecatedEmission(res));

/** Leitura legada — preferir GET /api/atendimentos/:id (campo dados_clinicos.memed_receita). */
router.get('/:id', requireAuth, async (req, res) => {
  res.setHeader('X-Deprecated-Endpoint', 'true');
  res.setHeader('X-Official-Flow', 'memed-widget-sinapse');
  const correlationId = req.correlationId || req.get('X-Correlation-Id') || req.requestId || 'unknown';
  try {
    const stored = await getPrescriptionByAtendimento(req.params.id);
    if (stored) {
      await createAuditLog({
        entity_type: 'prescription',
        entity_id: stored.id,
        action: 'prescription_lookup',
        actor: req.user?.sub || 'backend',
        payload: { correlationId, atendimento_id: stored.atendimento_id, provider: stored.provider, status: stored.status }
      });
      return res.json({ ...toResponseFromStored(stored), correlationId });
    }

    if (
      !isMemedRealEnabled() &&
      (String(req.params.id).startsWith('dev-') || String(req.params.id).startsWith('mock-'))
    ) {
      await createAuditLog({
        entity_type: 'prescription',
        entity_id: req.params.id,
        action: 'prescription_mock_fallback',
        actor: req.user?.sub || 'backend',
        payload: { correlationId, reason: 'mock id' }
      });
      return res.json({ ...mockPrescriptionResponse(req.params.id), correlationId });
    }

    const result = await memed.getPrescription(req.params.id);
    if (result.source === 'memed') return res.json(result);
    if (isMemedRealEnabled() || !allowMemedMockFallback()) {
      return res.status(503).json({
        success: false,
        code: 'MEMED_REAL_MODE_NO_MOCK',
        error: result.error || result.warning || 'Receita indisponível — emita no widget Memed (/receita).',
        correlationId
      });
    }
    await createAuditLog({
      entity_type: 'prescription',
      entity_id: req.params.id,
      action: 'prescription_mock_fallback',
      actor: req.user?.sub || 'backend',
      payload: { correlationId, reason: result.error || 'Memed indisponível' }
    });
    return res.json({ ...mockPrescriptionResponse(req.params.id, result.error), correlationId });
  } catch (error) {
    if (isMemedRealEnabled() || !allowMemedMockFallback()) {
      return res.status(503).json({
        success: false,
        code: 'MEMED_REAL_MODE_NO_MOCK',
        error: error.message,
        correlationId
      });
    }
    await createAuditLog({
      entity_type: 'prescription',
      entity_id: req.params.id,
      action: 'prescription_mock_fallback',
      actor: req.user?.sub || 'backend',
      payload: { correlationId, error: error.message }
    });
    return res.json({ ...mockPrescriptionResponse(req.params.id, error.message), correlationId });
  }
});

router.get('/:id/pdf', requireAuth, async (req, res) => {
  const allowDevPdf =
    !isMemedRealEnabled() &&
    (String(req.params.id).startsWith('dev-') || String(req.params.id).startsWith('mock-') || process.env.NODE_ENV !== 'production');
  if (allowDevPdf) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="receita_${req.params.id}.pdf"`);
    return res.send(mockPdfBuffer(req.params.id));
  }

  try {
    const result = await memed.downloadPdf(req.params.id);
    if (result.success) {
      res.setHeader('Content-Type', 'application/pdf');
      return res.send(result.pdf);
    }
  } catch {
    // Keep the MVP stable when Memed is unavailable.
  }

  if (isMemedRealEnabled() || !allowMemedMockFallback()) {
    return res.status(404).json({
      success: false,
      code: 'MEMED_PDF_NOT_AVAILABLE',
      error: 'PDF simulado indisponível em modo Memed real. Use o link HTTPS da receita emitida.'
    });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="receita_${req.params.id}.pdf"`);
  return res.send(mockPdfBuffer(req.params.id));
});

module.exports = router;
