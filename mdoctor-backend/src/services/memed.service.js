const axios = require('axios');

const DEFAULT_MEMED_URL = 'https://integrations.api.memed.com.br/v1';

function getConfig() {
  return {
    apiUrl: process.env.MEMED_API_URL || DEFAULT_MEMED_URL,
    apiKey: process.env.MEMED_API_KEY || '',
    secretKey: process.env.MEMED_SECRET_KEY || '',
    env: process.env.MEMED_ENV || process.env.MEMED_ENVIRONMENT || 'development',
    timeoutMs: Number(process.env.MEMED_TIMEOUT_MS || 8000),
    retryAttempts: Math.max(1, Number(process.env.MEMED_RETRY_ATTEMPTS || 2)),
    allowMockFallback: process.env.MEMED_ALLOW_MOCK_FALLBACK !== 'false'
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(task, { attempts, label }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(Math.min(500 * attempt, 2000));
      }
    }
  }
  throw lastError || new Error(`Falha após ${attempts} tentativas em ${label}`);
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

function applyMemedFailure(atendimento, mapped) {
  const config = getConfig();
  if (!config.allowMockFallback) {
    return {
      success: false,
      source: 'memed',
      prescriptionId: null,
      pdfUrl: null,
      memedError: mapped,
      error: mapped.message
    };
  }
  return {
    ...buildMockPrescription(atendimento),
    warning: mapped.message,
    memedError: mapped
  };
}

/** @deprecated Fluxo oficial: widget Sinapse + POST /api/memed/receita */
async function createPrescription(atendimento = {}) {
  if (process.env.MEMED_ALLOW_LEGACY_REST !== 'true') {
    return {
      source: 'deprecated',
      error:
        'Emissão REST descontinuada. Use widget Memed/Sinapse e POST /api/memed/receita.',
      warning: 'MEMED_ALLOW_LEGACY_REST not enabled'
    };
  }
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
        notes: atendimento.dados_clinicos?.conduta_medica || atendimento.dados_clinicos?.conduta || ''
      },
      environment: config.env
    };

    const response = await withRetry(
      () =>
        axios.post(`${config.apiUrl}/prescriptions`, payload, {
          timeout: config.timeoutMs,
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
          },
          params: { 'api-key': config.apiKey, 'secret-key': config.secretKey }
        }),
      { attempts: config.retryAttempts, label: 'memed_create_prescription' }
    );

    return {
      success: true,
      source: 'memed',
      prescriptionId: response.data?.id,
      pdfUrl: response.data?.pdf_url || response.data?.pdfUrl,
      data: response.data
    };
  } catch (error) {
    const mapped = mapMemedError(error);
    return applyMemedFailure(atendimento, mapped);
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
