/**
 * Enriquecimento de receita Memed via API oficial (sem mock).
 * Usa credenciais api-key/secret-key + prescritor MEMED_PRESCRITOR_EXTERNAL_ID.
 */
const axios = require('axios');
const memed = require('../integrations/memed.service');

function prescriberExternalId() {
  return (
    process.env.MEMED_PRESCRITOR_EXTERNAL_ID ||
    process.env.MEDICO_EXTERNAL_ID ||
    ''
  ).trim();
}

function apiParams() {
  return {
    'api-key': process.env.MEMED_API_KEY,
    'secret-key': process.env.MEMED_SECRET_KEY
  };
}

function baseUrl() {
  return memed.baseUrl;
}

async function tryGet(path, headers = {}) {
  const response = await axios.get(`${baseUrl()}${path}`, {
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/json',
      ...headers
    },
    params: apiParams(),
    validateStatus: (status) => status < 500
  });
  if (response.status >= 400) return null;
  return response.data;
}

function pickUrl(data) {
  if (!data) return null;
  const attrs = data.data?.attributes || data.attributes || data;
  return (
    attrs.pdf_url ||
    attrs.url_document ||
    attrs.document_url ||
    attrs.link ||
    attrs.digital_link ||
    data.pdf_url ||
    data.url ||
    null
  );
}

function pickDigital(data) {
  if (!data) return { link: null, unlockCode: null };
  const attrs = data.data?.attributes || data.attributes || data;
  return {
    link: attrs.link || attrs.digital_link || attrs.url || data.link || null,
    unlockCode:
      attrs.codigo_desbloqueio ||
      attrs.unlock_code ||
      attrs.codigoDesbloqueio ||
      data.codigo_desbloqueio ||
      data.unlock_code ||
      null
  };
}

/**
 * Busca PDF, link digital e código de desbloqueio para prescription_id Memed.
 */
async function fetchPrescriptionArtifacts(prescriptionId) {
  const id = String(prescriptionId || '').trim();
  if (!id || !memed.hasCredentials()) {
    return { pdfUrl: null, digitalLink: null, unlockCode: null, source: null };
  }

  const externalId = prescriberExternalId();
  const paths = {
    digital: [
      `/sinapse-prescricao/usuarios/${encodeURIComponent(externalId)}/prescricoes/${encodeURIComponent(id)}/get-digital-prescription-link`,
      `/sinapse-prescricao/prescricoes/${encodeURIComponent(id)}/get-digital-prescription-link`,
      `/prescricoes/${encodeURIComponent(id)}/get-digital-prescription-link`
    ],
    pdf: [
      `/sinapse-prescricao/usuarios/${encodeURIComponent(externalId)}/prescricoes/${encodeURIComponent(id)}/url-document/full`,
      `/sinapse-prescricao/prescricoes/${encodeURIComponent(id)}/url-document/full`,
      `/prescricoes/${encodeURIComponent(id)}/url-document/full`
    ],
    detail: [
      `/sinapse-prescricao/prescricoes/${encodeURIComponent(id)}`,
      `/prescricoes/${encodeURIComponent(id)}`
    ]
  };

  let digitalLink = null;
  let unlockCode = null;
  let pdfUrl = null;
  let source = null;

  for (const path of paths.digital) {
    try {
      const data = await tryGet(path);
      const picked = pickDigital(data);
      if (picked.link) {
        digitalLink = picked.link;
        unlockCode = picked.unlockCode || unlockCode;
        source = 'digital-link';
        break;
      }
    } catch {
      /* próximo path */
    }
  }

  for (const path of paths.pdf) {
    try {
      const data = await tryGet(path);
      const url = pickUrl(data);
      if (url) {
        pdfUrl = url;
        source = source || 'pdf-url';
        break;
      }
    } catch {
      /* próximo path */
    }
  }

  if (!pdfUrl || !digitalLink) {
    for (const path of paths.detail) {
      try {
        const data = await tryGet(path);
        if (!pdfUrl) pdfUrl = pickUrl(data);
        const picked = pickDigital(data);
        if (!digitalLink) digitalLink = picked.link;
        if (!unlockCode) unlockCode = picked.unlockCode;
        if (pdfUrl || digitalLink) {
          source = source || 'prescription-detail';
          break;
        }
      } catch {
        /* próximo path */
      }
    }
  }

  return { pdfUrl, digitalLink, unlockCode, source };
}

module.exports = {
  fetchPrescriptionArtifacts,
  prescriberExternalId
};
