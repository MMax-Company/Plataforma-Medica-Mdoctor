const express = require('express');
const memed = require('../services/memed.service');
const { requireAuth } = require('../auth/auth.middleware');
const { createAuditLog } = require('../store/audit.store');
const { getAtendimento, updateAtendimentoStatus, STATUS } = require('../store/atendimentos.store');
const { getPrescriptionByAtendimento, savePrescription } = require('../store/prescriptions.store');

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

router.post('/', requireAuth, async (req, res) => {
  try {
    const result = await memed.createPrescription(req.body || {});
    if (result.source === 'memed') {
      const saved = await savePrescription({
        atendimento_id: req.body?.atendimento_id || req.body?.atendimentoId || null,
        patient_id: req.body?.patient_id || req.body?.patientId || null,
        status: 'ready',
        provider: 'memed',
        provider_prescription_id: result.prescriptionId,
        pdf_url: result.pdfUrl,
        medications: req.body?.medications || [],
        payload: result.data || result
      });
      return res.status(201).json({ ...result, data: saved });
    }

    const prescriptionId = `mock-${Date.now()}`;
    const saved = await savePrescription({
      id: prescriptionId,
      atendimento_id: req.body?.atendimento_id || req.body?.atendimentoId || null,
      patient_id: req.body?.patient_id || req.body?.patientId || null,
      status: 'mock',
      provider: 'mock',
      pdf_url: `/api/prescriptions/${prescriptionId}/pdf`,
      medications: req.body?.medications || [],
      payload: mockPrescriptionResponse(prescriptionId, result.error, req.body || {}).data
    });
    return res.status(201).json({
      ...mockPrescriptionResponse(prescriptionId, result.error, req.body || {}),
      data: { ...mockPrescriptionResponse(prescriptionId, result.error, req.body || {}).data, stored: saved },
      prescriptionId,
      pdfUrl: `/api/prescriptions/${prescriptionId}/pdf`
    });
  } catch (error) {
    const prescriptionId = `mock-${Date.now()}`;
    const saved = await savePrescription({
      id: prescriptionId,
      atendimento_id: req.body?.atendimento_id || req.body?.atendimentoId || null,
      patient_id: req.body?.patient_id || req.body?.patientId || null,
      status: 'mock',
      provider: 'mock',
      pdf_url: `/api/prescriptions/${prescriptionId}/pdf`,
      payload: mockPrescriptionResponse(prescriptionId, error.message, req.body || {}).data
    });
    return res.status(201).json({
      ...mockPrescriptionResponse(prescriptionId, error.message, req.body || {}),
      data: { ...mockPrescriptionResponse(prescriptionId, error.message, req.body || {}).data, stored: saved },
      prescriptionId,
      pdfUrl: `/api/prescriptions/${prescriptionId}/pdf`
    });
  }
});

router.post('/:id/generate', requireAuth, async (req, res) => {
  try {
    const atendimento = await getAtendimento(req.params.id);
    if (!atendimento) {
      return res.status(404).json({ success: false, error: 'Atendimento não encontrado', code: 'ATENDIMENTO_NOT_FOUND' });
    }

    const result = await memed.createPrescription({ ...atendimento, ...(req.body || {}) });
    const saved = await savePrescription({
      atendimento_id: atendimento.id,
      patient_id: atendimento.patient_id || null,
      status: result.source === 'memed' ? 'ready' : 'mock',
      provider: result.source,
      provider_prescription_id: result.prescriptionId,
      pdf_url: result.pdfUrl,
      medications: [atendimento.medicacao_em_uso || atendimento.dados_clinicos?.medicacao_em_uso || 'Medicamento conforme avaliação médica'],
      payload: result.data || result
    });

    const updated = await updateAtendimentoStatus(atendimento.id, STATUS.READY, {
      motivo: result.source === 'memed' ? 'Receita gerada na Memed' : 'Receita mock gerada para staging',
      medicoId: req.user?.sub || null,
      dados_clinicos: {
        ...(atendimento.dados_clinicos || {}),
        memed_receita: {
          receitaId: saved.id,
          providerPrescriptionId: saved.provider_prescription_id,
          source: result.source,
          pdfUrl: saved.pdf_url
        }
      }
    });

    await createAuditLog({
      entity_type: 'prescription',
      entity_id: saved.id,
      action: 'prescription_generate',
      actor: req.user?.sub || 'backend',
      payload: { atendimento_id: atendimento.id, source: result.source, warning: result.warning || null }
    });

    return res.status(201).json({
      success: true,
      source: result.source,
      warning: result.warning || null,
      prescription: saved,
      atendimento: updated,
      data: toResponseFromStored(saved).data
    });
  } catch (error) {
    return res.status(200).json({
      ...mockPrescriptionResponse(req.params.id, error.message),
      code: 'PRESCRIPTION_GENERATE_FALLBACK'
    });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const stored = await getPrescriptionByAtendimento(req.params.id);
    if (stored) {
      await createAuditLog({
        entity_type: 'prescription',
        entity_id: stored.id,
        action: 'prescription_lookup',
        actor: req.user?.sub || 'backend',
        payload: { atendimento_id: stored.atendimento_id, provider: stored.provider, status: stored.status }
      });
      return res.json(toResponseFromStored(stored));
    }

    if (String(req.params.id).startsWith('dev-') || String(req.params.id).startsWith('mock-')) {
      await createAuditLog({
        entity_type: 'prescription',
        entity_id: req.params.id,
        action: 'prescription_mock_fallback',
        actor: req.user?.sub || 'backend',
        payload: { reason: 'mock id' }
      });
      return res.json(mockPrescriptionResponse(req.params.id));
    }

    const result = await memed.getPrescription(req.params.id);
    if (result.source === 'memed') return res.json(result);
    await createAuditLog({
      entity_type: 'prescription',
      entity_id: req.params.id,
      action: 'prescription_mock_fallback',
      actor: req.user?.sub || 'backend',
      payload: { reason: result.error || 'Memed indisponível' }
    });
    return res.json(mockPrescriptionResponse(req.params.id, result.error));
  } catch (error) {
    await createAuditLog({
      entity_type: 'prescription',
      entity_id: req.params.id,
      action: 'prescription_mock_fallback',
      actor: req.user?.sub || 'backend',
      payload: { error: error.message }
    });
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
