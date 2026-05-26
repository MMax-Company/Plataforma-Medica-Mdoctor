const express = require('express');
const memed = require('../integrations/memed.service');
const { requireAuth } = require('../auth/auth.middleware');

const router = express.Router();

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
  const result = await memed.createPrescription(req.body || {});
  const isDevFallback = !result.success && process.env.NODE_ENV !== 'production';

  if (result.success) return res.status(201).json(result);
  if (!isDevFallback) return res.status(502).json(result);

  const prescriptionId = `dev-${Date.now()}`;
  return res.status(201).json({
    success: true,
    prescriptionId,
    pdfUrl: `/api/prescriptions/${prescriptionId}/pdf`,
    mode: 'development',
    warning: result.error
  });
});

router.get('/:id', requireAuth, async (req, res) => {
  if (String(req.params.id).startsWith('dev-')) {
    return res.json({ success: true, data: { id: req.params.id, mode: 'development' } });
  }

  const result = await memed.getPrescriptionById(req.params.id);
  if (!result.success) return res.status(502).json(result);
  return res.json(result);
});

router.get('/:id/pdf', requireAuth, async (req, res) => {
  if (String(req.params.id).startsWith('dev-') || process.env.NODE_ENV !== 'production') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="receita_${req.params.id}.pdf"`);
    return res.send(mockPdfBuffer(req.params.id));
  }

  const result = await memed.downloadPdf(req.params.id);
  if (!result.success) return res.status(502).json(result);
  res.setHeader('Content-Type', 'application/pdf');
  return res.send(result.pdf);
});

module.exports = router;
