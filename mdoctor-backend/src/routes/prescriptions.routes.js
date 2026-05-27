const express = require('express');
const memed = require('../integrations/memed.service');
const { requireAuth } = require('../auth/auth.middleware');

const router = express.Router();

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
    data: buildMockPrescription(id, payload),
    mode: 'mock',
    warning: warning || 'Memed real indisponível. Exibindo receita simulada.'
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

router.post('/', requireAuth, async (req, res) => {
  try {
    const result = await memed.createPrescription(req.body || {});
    if (result.success) return res.status(201).json(result);

    const prescriptionId = `mock-${Date.now()}`;
    return res.status(201).json({
      ...mockPrescriptionResponse(prescriptionId, result.error, req.body || {}),
      prescriptionId,
      pdfUrl: `/api/prescriptions/${prescriptionId}/pdf`
    });
  } catch (error) {
    const prescriptionId = `mock-${Date.now()}`;
    return res.status(201).json({
      ...mockPrescriptionResponse(prescriptionId, error.message, req.body || {}),
      prescriptionId,
      pdfUrl: `/api/prescriptions/${prescriptionId}/pdf`
    });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    if (String(req.params.id).startsWith('dev-') || String(req.params.id).startsWith('mock-')) {
      return res.json(mockPrescriptionResponse(req.params.id));
    }

    const result = await memed.getPrescriptionById(req.params.id);
    if (result.success) return res.json(result);
    return res.json(mockPrescriptionResponse(req.params.id, result.error));
  } catch (error) {
    return res.json(mockPrescriptionResponse(req.params.id, error.message));
  }
});

router.get('/:id/pdf', requireAuth, async (req, res) => {
  if (String(req.params.id).startsWith('dev-') || process.env.NODE_ENV !== 'production') {
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

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="receita_${req.params.id}.pdf"`);
  return res.send(mockPdfBuffer(req.params.id));
});

module.exports = router;
