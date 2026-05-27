const express = require('express');
const eligibilityEngine = require('../eligibility/engine');
const { sendPrescription } = require('../delivery/delivery.service');
const { requireAuth } = require('../auth/auth.middleware');
const {
  VALID_STATUS,
  STATUS,
  normalizeStatus,
  listAtendimentos,
  getAtendimento,
  createAtendimento,
  updateAtendimentoStatus,
  createDecisaoLog,
  listDecisoesLog,
  createEntregaReceitaLog
} = require('../store/atendimentos.store');

const router = express.Router();

function isPaid(atendimento = {}) {
  return String(atendimento.pagamento_status || '').toUpperCase() === 'CONFIRMADO';
}

function isClinicallyEligible(atendimento = {}) {
  return atendimento.elegibilidade?.eligible === true || atendimento.risco === 'BAIXO';
}

function isDeliveryMockEnabled() {
  return process.env.DELIVERY_MOCK_ENABLED === 'true' || process.env.NODE_ENV !== 'production';
}

function maskTarget(target = '') {
  return String(target).includes('@')
    ? String(target).replace(/^(.{2}).*(@.*)$/, '$1***$2')
    : String(target).replace(/\d(?=\d{4})/g, '*');
}

router.get('/', async (req, res) => {
  const atendimentos = await listAtendimentos({ status: req.query.status });
  res.json({ success: true, atendimentos });
});

router.get('/queue', async (_req, res) => {
  const atendimentos = await listAtendimentos({
    status: [
      STATUS.FILA,
      STATUS.QUEUE,
      STATUS.EM_ATENDIMENTO,
      STATUS.UNDER_REVIEW,
      STATUS.MEMED_PROCESSING,
      STATUS.AWAITING_VALIDATION,
      STATUS.PRONTO_PARA_DECISAO,
      STATUS.APROVADO,
      STATUS.VALIDATED,
      STATUS.RECEITA_EMITIDA
    ].join(',')
  });
  res.json({
    success: true,
    atendimentos: atendimentos.filter((item) => isPaid(item) && isClinicallyEligible(item))
  });
});

router.post('/', async (req, res) => {
  const clinicalData = req.body?.dados_clinicos || req.body || {};
  const decision = eligibilityEngine.evaluate(clinicalData);
  const paymentStatus =
    typeof req.body?.pagamento === 'boolean'
      ? req.body.pagamento
        ? 'CONFIRMADO'
        : 'PENDENTE'
      : req.body?.pagamento_status || req.body?.pagamento || req.body?.paymentStatus || 'PENDENTE';
  const paymentConfirmed = String(paymentStatus).toUpperCase() === 'CONFIRMADO';
  const requestedStatus = req.body?.status ? normalizeStatus(req.body.status) : null;
  const status = !decision.eligible
    ? STATUS.REJECTED
    : paymentConfirmed
      ? requestedStatus || STATUS.QUEUE
      : STATUS.AGUARDANDO_PAGAMENTO;

  const atendimento = await createAtendimento({
    ...req.body,
    status,
    pagamento_status: paymentStatus,
    risco: decision.eligible ? 'BAIXO' : 'BLOQUEADO',
    elegibilidade: decision,
    dados_clinicos: clinicalData
  });

  res.status(201).json({ success: true, atendimento });
});

router.get('/:id', async (req, res) => {
  const atendimento = await getAtendimento(req.params.id);
  if (!atendimento) return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });
  return res.json({ success: true, atendimento });
});

router.get('/:id/decisoes', async (req, res) => {
  const decisoes = await listDecisoesLog(req.params.id);
  return res.json({ success: true, decisoes });
});

router.patch('/:id/clinical', requireAuth, async (req, res) => {
  const authenticatedDoctorId = req.user?.sub || null;
  const previous = await getAtendimento(req.params.id);
  if (!previous) return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });

  const clinical = req.body?.dados_clinicos || {};
  const mergedClinical = {
    ...(previous.dados_clinicos || {}),
    ...clinical
  };

  const atendimento = await updateAtendimentoStatus(req.params.id, previous.status, {
    motivo: 'Prontuário editado pelo médico',
    medicoId: authenticatedDoctorId,
    paciente_nome: req.body?.paciente_nome ?? previous.paciente_nome,
    paciente_telefone: req.body?.paciente_telefone ?? previous.paciente_telefone,
    paciente_cpf: req.body?.paciente_cpf ?? previous.paciente_cpf,
    paciente_email: req.body?.paciente_email ?? previous.paciente_email,
    condicao: req.body?.condicao ?? previous.condicao,
    pagamento_status: req.body?.pagamento_status ?? previous.pagamento_status,
    dados_clinicos: mergedClinical
  });

  if (!atendimento) {
    return res.status(500).json({ success: false, error: 'Não foi possível salvar o prontuário' });
  }

  const decisao = await createDecisaoLog({
    atendimento_id: req.params.id,
    status_anterior: previous.status,
    status_novo: previous.status,
    motivo: 'Prontuário editado pelo médico',
    medico_id: authenticatedDoctorId,
    snapshot: {
      paciente_nome: atendimento.paciente_nome,
      condicao: atendimento.condicao,
      dados_clinicos: mergedClinical
    }
  });

  return res.json({ success: true, atendimento, decisao });
});

router.post('/:id/deliver', requireAuth, async (req, res) => {
  const { channel = 'whatsapp', doctorId, medicoId } = req.body || {};
  const authenticatedDoctorId = req.user?.sub || medicoId || doctorId || null;
  const allowedChannels = new Set(['whatsapp', 'email', 'sms']);
  if (!allowedChannels.has(channel)) {
    return res.status(400).json({ success: false, error: 'Canal de entrega inválido' });
  }

  const previous = await getAtendimento(req.params.id);
  if (!previous) return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });

  const receipt = previous.dados_clinicos?.memed_receita || {};
  const receiptUrl = receipt.pdfUrl || receipt.receitaUrl || (isDeliveryMockEnabled() ? `/api/prescriptions/${req.params.id}/pdf` : '');
  if (!receiptUrl) {
    return res.status(400).json({ success: false, error: 'Receita Memed não encontrada para entrega' });
  }

  const target =
    channel === 'email'
      ? previous.paciente_email
      : previous.paciente_telefone;

  if (!target && !isDeliveryMockEnabled()) {
    return res.status(400).json({ success: false, error: `Contato do paciente ausente para ${channel}` });
  }

  const previousClinical = previous.dados_clinicos || {};
  const previousDeliveries = Array.isArray(previousClinical.entregas_receita)
    ? previousClinical.entregas_receita
    : previousClinical.entrega_receita
      ? [previousClinical.entrega_receita]
      : [];

  let delivery;
  try {
    if (isDeliveryMockEnabled()) {
      delivery = {
        id: `delivery-mock-${Date.now()}`,
        channel,
        targetMasked: maskTarget(target || 'mock-target'),
        receiptUrl,
        provider: 'mock',
        status: 'sent',
        sent_at: new Date().toISOString()
      };
    } else {
      delivery = await sendPrescription({
        channel,
        target,
        receiptUrl,
        pacienteNome: previous.paciente_nome
      });
    }
  } catch (error) {
    const failedDelivery = {
      id: `delivery-failed-${Date.now()}`,
      channel,
      targetMasked: target.includes('@') ? target.replace(/^(.{2}).*(@.*)$/, '$1***$2') : target.replace(/\d(?=\d{4})/g, '*'),
      receiptUrl,
      provider: error.code === 'PROVIDER_NOT_CONFIGURED' ? 'not-configured' : 'provider-error',
      status: 'failed',
      error: error.message,
      attempted_at: new Date().toISOString()
    };

    const atendimento = await updateAtendimentoStatus(req.params.id, previous.status, {
      motivo: `Falha na entrega por ${channel}: ${error.message}`,
      medicoId: authenticatedDoctorId,
      dados_clinicos: {
        ...previousClinical,
        memed_receita: receipt,
        entrega_receita: failedDelivery,
        entregas_receita: [failedDelivery, ...previousDeliveries]
      }
    });

    await createDecisaoLog({
      atendimento_id: req.params.id,
      status_anterior: previous.status,
      status_novo: previous.status,
      motivo: `Falha na entrega por ${channel}: ${error.message}`,
      medico_id: authenticatedDoctorId,
      snapshot: {
        delivery: failedDelivery,
        receitaId: receipt.receitaId || null
      }
    });

    await createEntregaReceitaLog({
      id: failedDelivery.id,
      atendimento_id: req.params.id,
      canal: channel,
      provider: failedDelivery.provider,
      status: failedDelivery.status,
      target_masked: failedDelivery.targetMasked,
      erro: failedDelivery.error,
      snapshot: failedDelivery,
      criado_em: failedDelivery.attempted_at
    });

    const statusCode = error.code === 'PROVIDER_NOT_CONFIGURED' ? 503 : 502;
    return res.status(statusCode).json({
      success: false,
      error: error.message,
      code: error.code || 'DELIVERY_FAILED',
      atendimento,
      delivery: failedDelivery
    });
  }

  const atendimento = await updateAtendimentoStatus(req.params.id, STATUS.DELIVERED, {
    motivo: `Receita enviada por ${channel}`,
    medicoId: authenticatedDoctorId,
    dados_clinicos: {
      ...previousClinical,
      memed_receita: receipt,
      entrega_receita: delivery,
      entregas_receita: [delivery, ...previousDeliveries]
    }
  });

  const decisao = await createDecisaoLog({
    atendimento_id: req.params.id,
    status_anterior: previous.status,
    status_novo: STATUS.DELIVERED,
    motivo: `Entrega concluída por ${channel}`,
    medico_id: authenticatedDoctorId,
    snapshot: {
      delivery,
      receitaId: receipt.receitaId || null
    }
  });

  await createEntregaReceitaLog({
    id: delivery.id,
    atendimento_id: req.params.id,
    canal: channel,
    provider: delivery.provider,
    provider_message_id: delivery.providerMessageId,
    status: delivery.status,
    target_masked: delivery.targetMasked,
    snapshot: delivery,
    criado_em: delivery.sent_at
  });

  return res.json({ success: true, atendimento, decisao, delivery });
});

router.patch('/:id/status', requireAuth, async (req, res) => {
  const { status, motivo, notes, doctorId, medicoId } = req.body || {};
  const authenticatedDoctorId = req.user?.sub || medicoId || doctorId || null;
  if (!status) {
    return res.status(400).json({ success: false, error: 'Status obrigatório', code: 'STATUS_REQUIRED' });
  }

  const normalizedStatus = normalizeStatus(status);
  if (!VALID_STATUS.has(status) && !VALID_STATUS.has(normalizedStatus)) {
    return res.status(400).json({ success: false, error: 'Status inválido', code: 'STATUS_INVALID' });
  }

  const previous = await getAtendimento(req.params.id);
  if (!previous) return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });

  const atendimento = await updateAtendimentoStatus(req.params.id, normalizedStatus, {
    motivo,
    notes,
    doctorId: authenticatedDoctorId,
    medicoId: authenticatedDoctorId
  });

  if (!atendimento) return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });

  const decisao = await createDecisaoLog({
    atendimento_id: req.params.id,
    status_anterior: previous.status,
    status_novo: normalizedStatus,
    motivo: motivo || notes || null,
    medico_id: authenticatedDoctorId,
    snapshot: {
      paciente_nome: atendimento.paciente_nome,
      condicao: atendimento.condicao,
      risco: atendimento.risco,
      elegibilidade: atendimento.elegibilidade
    }
  });

  return res.json({ success: true, atendimento, decisao });
});

module.exports = router;
