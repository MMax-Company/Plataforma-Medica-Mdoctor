const express = require('express');
const memed = require('../integrations/memed.service');
const { requireAuth } = require('../auth/auth.middleware');
const { STATUS, getAtendimento, updateAtendimentoStatus, createDecisaoLog } = require('../store/atendimentos.store');
const { createReceitaLog } = require('../store/receitas.store');

const router = express.Router();

function defaultScriptUrl() {
  if (process.env.MEMED_SCRIPT_URL) return process.env.MEMED_SCRIPT_URL;
  if (process.env.MEMED_ENVIRONMENT === 'production') {
    return 'https://partners.memed.com.br/integration.js';
  }
  return 'https://integrations.memed.com.br/modulos/plataforma.sinapse-prescricao/build/sinapse-prescricao.min.js';
}

router.get('/config', (_req, res) => {
  res.json({
    success: true,
    config: {
      enabled: process.env.MEMED_ENABLED === 'true' || memed.hasCredentials() || memed.hasStaticToken(),
      environment: process.env.MEMED_ENVIRONMENT || process.env.MEMED_ENV || 'development',
      scriptUrl: defaultScriptUrl(),
      containerId: 'prescricao-memed',
      primaryColor: '#1557FF',
      dimensions: {
        minWidth: 820,
        minHeight: 700
      }
    }
  });
});

router.post('/auth', requireAuth, async (req, res) => {
  try {
    const doctor = {
      crm: req.body?.crm || process.env.MEDICO_CRM || process.env.MEMED_PRESCRITOR_BOARD_NUMBER,
      uf: req.body?.uf || process.env.MEDICO_CRM_UF || process.env.MEMED_PRESCRITOR_BOARD_STATE,
      nome: req.body?.nome || `${process.env.MEDICO_NOME || ''} ${process.env.MEDICO_SOBRENOME || ''}`.trim(),
      cpf: req.body?.cpf || process.env.MEDICO_CPF || process.env.MEMED_PRESCRITOR_CPF,
      email: req.body?.email || process.env.MEDICO_EMAIL || process.env.MEMED_PRESCRITOR_EMAIL,
      telefone: req.body?.telefone || process.env.MEDICO_TELEFONE || process.env.MEMED_PRESCRITOR_TELEFONE,
      sexo: req.body?.sexo || process.env.MEDICO_SEXO || process.env.MEMED_PRESCRITOR_SEXO,
      data_nascimento: req.body?.data_nascimento || process.env.MEDICO_DATA_NASC || process.env.MEMED_PRESCRITOR_DATA_NASC,
      external_id: req.body?.external_id || process.env.MEDICO_EXTERNAL_ID || process.env.MEMED_PRESCRITOR_EXTERNAL_ID
    };

    const result = await memed.authenticatePrescriber(doctor);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(502).json({
      success: false,
      error: 'Erro ao autenticar prescritor na Memed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/token', requireAuth, async (_req, res) => {
  try {
    const result = await memed.authenticatePrescriber({
      crm: process.env.MEDICO_CRM || process.env.MEMED_PRESCRITOR_BOARD_NUMBER,
      uf: process.env.MEDICO_CRM_UF || process.env.MEMED_PRESCRITOR_BOARD_STATE,
      nome:
        `${process.env.MEDICO_NOME || process.env.MEMED_PRESCRITOR_NOME || ''} ${
          process.env.MEDICO_SOBRENOME || process.env.MEMED_PRESCRITOR_SOBRENOME || ''
        }`.trim(),
      cpf: process.env.MEDICO_CPF || process.env.MEMED_PRESCRITOR_CPF,
      email: process.env.MEDICO_EMAIL || process.env.MEMED_PRESCRITOR_EMAIL,
      telefone: process.env.MEDICO_TELEFONE || process.env.MEMED_PRESCRITOR_TELEFONE,
      sexo: process.env.MEDICO_SEXO || process.env.MEMED_PRESCRITOR_SEXO,
      data_nascimento: process.env.MEDICO_DATA_NASC || process.env.MEMED_PRESCRITOR_DATA_NASC,
      external_id: process.env.MEDICO_EXTERNAL_ID || process.env.MEMED_PRESCRITOR_EXTERNAL_ID
    });
    res.json({ success: true, token: result.token, prescriber: result.prescriber });
  } catch (error) {
    res.status(502).json({
      success: false,
      error: 'Erro ao obter token Memed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/receita', requireAuth, async (req, res) => {
  const { atendimentoId, receitaUrl, receitaId, pdfUrl, protocolo, protocol, storagePath, payload } = req.body || {};
  if (!atendimentoId) {
    return res.status(400).json({ success: false, error: 'atendimentoId obrigatório' });
  }

  const previous = await getAtendimento(atendimentoId);
  if (!previous) return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });

  const receita = {
    atendimentoId,
    receitaUrl: receitaUrl || pdfUrl || null,
    pdfUrl: pdfUrl || receitaUrl || null,
    receitaId: receitaId || null,
    protocolo: protocolo || protocol || null,
    storagePath: storagePath || null,
    payload: payload || {},
    gerada_em: new Date().toISOString(),
    origem: 'Memed'
  };
  const medicoId = req.user?.sub || process.env.MEDICO_EXTERNAL_ID || process.env.MEMED_PRESCRITOR_EXTERNAL_ID || null;

  const receitaLog = await createReceitaLog({
    atendimentoId,
    receitaId: receita.receitaId,
    protocolo: receita.protocolo,
    receitaUrl: receita.receitaUrl,
    pdfUrl: receita.pdfUrl,
    storagePath: receita.storagePath,
    status: STATUS.AWAITING_VALIDATION,
    payload: receita.payload,
    medicoId
  });

  const atendimento = await updateAtendimentoStatus(atendimentoId, STATUS.AWAITING_VALIDATION, {
    motivo: 'Receita gerada na Memed aguardando validação médica',
    medicoId,
    dados_clinicos: {
      ...(previous.dados_clinicos || {}),
      memed_receita: {
        ...receita,
        logId: receitaLog.id
      }
    }
  });

  const decisao = await createDecisaoLog({
    atendimento_id: atendimentoId,
    status_anterior: previous.status,
    status_novo: STATUS.AWAITING_VALIDATION,
    motivo: 'Receita Memed vinculada e aguardando aceite médico',
    medico_id: medicoId,
    snapshot: {
      ...receita,
      receitaLogId: receitaLog.id
    }
  });

  return res.json({
    success: true,
    atendimento,
    decisao,
    receita,
    receitaLog
  });
});

router.post('/verify', requireAuth, (req, res) => {
  const result = memed.validateToken(req.body?.token);
  res.status(result.valid ? 200 : 400).json(result);
});

module.exports = router;
