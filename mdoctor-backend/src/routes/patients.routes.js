const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { requireIngressOrAuth } = require('../middlewares/ingress-service-auth');
const {
  listPatients,
  getPatient,
  createPatient,
  updatePatientStatus
} = require('../store/patients.store');

const router = express.Router();
const VALID_STATUS = new Set(['pending', 'approved', 'rejected', 'receita_emitida']);

router.get('/', requireAuth, async (_req, res) => {
  const patients = await listPatients();
  res.json({ success: true, patients });
});

router.post('/', requireIngressOrAuth, async (req, res) => {
  const patient = await createPatient(req.body || {});
  res.status(201).json({ success: true, patient });
});

router.get('/:id', requireAuth, async (req, res) => {
  const patient = await getPatient(req.params.id);
  if (!patient) return res.status(404).json({ success: false, error: 'Paciente não encontrado' });
  return res.json({ success: true, patient });
});

router.patch('/:id/status', requireAuth, async (req, res) => {
  const { status, doctorId, notes } = req.body || {};
  if (!VALID_STATUS.has(status)) {
    return res.status(400).json({ success: false, error: 'Status inválido' });
  }

  const patient = await updatePatientStatus(req.params.id, status, { doctorId, notes });
  if (!patient) return res.status(404).json({ success: false, error: 'Paciente não encontrado' });
  return res.json({ success: true, patient });
});

module.exports = router;
