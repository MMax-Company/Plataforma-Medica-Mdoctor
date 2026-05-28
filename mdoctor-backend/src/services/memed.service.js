const axios = require('axios');

const DEFAULT_MEMED_URL = 'https://integrations.api.memed.com.br/v1';

function getConfig() {
  return {
    apiUrl: process.env.MEMED_API_URL || DEFAULT_MEMED_URL,
    apiKey: process.env.MEMED_API_KEY || '',
    secretKey: process.env.MEMED_SECRET_KEY || '',
    env: process.env.MEMED_ENV || process.env.MEMED_ENVIRONMENT || 'development',
    timeoutMs: Number(process.env.MEMED_TIMEOUT_MS || 8000)
  };
}

function isMemedConfigured() {
  const config = getConfig();
  return Boolean(config.apiUrl && config.apiKey && config.secretKey && config.apiKey !== 'sua_chave');
}

function mapMemedError(error) {
  if (!error) return { code: 'MEMED_UNAVAILABLE', message: 'Memed indisponível' };
  if (error.response) {
    return {
      code: `MEMED_HTTP_${error.response.status}`,
      message: error.response.data?.message || error.response.data?.error || 'Falha controlada na Memed',
      status: error.response.status
    };
  }
  if (error.code === 'ECONNABORTED') {
    return { code: 'MEMED_TIMEOUT', message: 'Tempo limite da Memed excedido' };
  }
  return { code: error.code || 'MEMED_ERROR', message: error.message || 'Falha controlada na Memed' };
}

function buildMockPrescription(atendimento = {}) {
  const id = `mock-${atendimento.id || Date.now()}`;
  return {
    success: true,
    source: 'mock',
    warning: 'Memed não configurada. Receita simulada para staging técnico.',
    prescriptionId: id,
    pdfUrl: `/api/prescriptions/${encodeURIComponent(id)}/pdf`,
    data: {
      id,
      mode: 'mock',
      patientName: atendimento.paciente_nome || 'Paciente',
      medication: atendimento.medicacao_em_uso || atendimento.dados_clinicos?.medicacao_em_uso || 'Medicamento conforme avaliação médica',
      dosage: 'Conforme posologia definida pelo médico',
      instructions: 'Receita simulada para continuidade do MVP. Integração Memed real ainda indisponível.',
      duration: '30 dias',
      issuedBy: process.env.MEDICO_NOME || 'Médico responsável',
      createdAt: new Date().toISOString()
    }
  };
}

async function createPrescription(atendimento = {}) {
  const config = getConfig();
  if (!isMemedConfigured()) return buildMockPrescription(atendimento);

  try {
    const payload = {
      patient: {
        name: atendimento.paciente_nome || '',
        document: atendimento.paciente_cpf || '',
        phone: atendimento.paciente_telefone || '',
        email: atendimento.paciente_email || ''
      },
      prescription: {
        medications: [atendimento.medicacao_em_uso || atendimento.dados_clinicos?.medicacao_em_uso || 'Medicamento não informado'],
        notes: atendimento.dados_clinicos?.conduta || ''
      },
      environment: config.env
    };

    const response = await axios.post(`${config.apiUrl}/prescriptions`, payload, {
      timeout: config.timeoutMs,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      params: { 'api-key': config.apiKey, 'secret-key': config.secretKey }
    });

    return {
      success: true,
      source: 'memed',
      prescriptionId: response.data?.id,
      pdfUrl: response.data?.pdf_url,
      data: response.data
    };
  } catch (error) {
    const mapped = mapMemedError(error);
    return {
      ...buildMockPrescription(atendimento),
      warning: mapped.message,
      memedError: mapped
    };
  }
}

async function getPrescription(providerPrescriptionId) {
  const config = getConfig();
  if (!isMemedConfigured()) {
    return buildMockPrescription({ id: providerPrescriptionId });
  }

  try {
    const response = await axios.get(`${config.apiUrl}/prescriptions/${providerPrescriptionId}`, {
      timeout: config.timeoutMs,
      headers: { Authorization: `Bearer ${config.apiKey}` }
    });

    return { success: true, source: 'memed', data: response.data };
  } catch (error) {
    const mapped = mapMemedError(error);
    return {
      ...buildMockPrescription({ id: providerPrescriptionId }),
      warning: mapped.message,
      memedError: mapped
    };
  }
}

async function downloadPdf(providerPrescriptionId) {
  const config = getConfig();
  if (!isMemedConfigured()) return { success: false, source: 'mock', error: 'Memed não configurada' };

  try {
    const response = await axios.get(`${config.apiUrl}/prescriptions/${providerPrescriptionId}/pdf`, {
      timeout: config.timeoutMs,
      headers: { Authorization: `Bearer ${config.apiKey}` },
      responseType: 'arraybuffer'
    });
    return { success: true, source: 'memed', pdf: Buffer.from(response.data, 'binary') };
  } catch (error) {
    return { success: false, source: 'mock', error: mapMemedError(error).message };
  }
}

function getMemedStatus() {
  const config = getConfig();
  return {
    configured: isMemedConfigured(),
    source: isMemedConfigured() ? 'memed' : 'mock',
    env: config.env,
    apiUrl: config.apiUrl
  };
}

module.exports = {
  createPrescription,
  downloadPdf,
  getMemedStatus,
  getPrescription,
  isMemedConfigured,
  mapMemedError
};
