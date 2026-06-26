/**
 * Enriquecimento de receita Memed via API oficial (sem mock).
 * Endpoints documentados:
 *   GET /prescricoes/{id}/url-document/full?token={prescriber_token}
 *   GET /prescricoes/{id}/get-digital-prescription-link?token={prescriber_token}
 * Autenticação: ?token= (query param), conforme doc.memed.com.br/docs/backend/prescricao.
 */
const axios = require('axios');
const memed = require('../integrations/memed.service');

function baseUrl() {
  return memed.baseUrl;
}

async function tryGet(path, params = {}) {
  const response = await axios.get(`${baseUrl()}${path}`, {
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/json'
    },
    params,
    validateStatus: (status) => status < 500,
    maxRedirects: 0
  });
  if (response.status >= 400) {
    console.warn('[memed-api] tryGet', response.status, path.split('/').slice(-3).join('/'));
    return null;
  }
  if (response.status >= 300 && response.headers?.location) {
    return { url: response.headers.location };
  }
  return response.data;
}

function pickUrl(data) {
  if (!data) return null;
  // Formato documentado: {"data":[{"attributes":{"link":"..."}}]}
  if (Array.isArray(data.data)) {
    const link = data.data[0]?.attributes?.link;
    if (link) return link;
  }
  // Formatos alternativos / legados
  const attrs = data.data?.attributes || data.attributes || data;
  return (
    attrs.pdf_url ||
    attrs.url_document ||
    attrs.document_url ||
    attrs.link ||
    attrs.digital_link ||
    attrs.url ||
    data.pdf_url ||
    data.url ||
    null
  );
}

function pickDigital(data) {
  if (!data) return { link: null, unlockCode: null };
  // Formato documentado: {"data":[{"attributes":{"link":"...","digits":"XXXX"}}]}
  if (Array.isArray(data.data)) {
    const item = data.data[0]?.attributes;
    if (item?.link) {
      return {
        link: item.link,
        unlockCode: item.digits || item.codigo_desbloqueio || item.unlock_code || null
      };
    }
  }
  // Formatos alternativos / legados
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
 * Usa autenticação via ?token= conforme documentação oficial.
 */
async function fetchPrescriptionArtifacts(prescriptionId) {
  const id = String(prescriptionId || '').trim();
  if (!id || !memed.hasCredentials()) {
    return { pdfUrl: null, digitalLink: null, unlockCode: null, source: null };
  }

  let prescriberToken = '';
  try {
    const auth = await memed.authenticatePrescriber(memed.buildDoctorFromEnv());
    prescriberToken = auth?.token || '';
  } catch {
    return { pdfUrl: null, digitalLink: null, unlockCode: null, source: null };
  }

  if (!prescriberToken) {
    return { pdfUrl: null, digitalLink: null, unlockCode: null, source: null };
  }

  const tokenParam = { token: prescriberToken };
  let pdfUrl = null;
  let digitalLink = null;
  let unlockCode = null;
  let source = null;

  // GET /prescricoes/{id}/url-document/full?token={token}
  try {
    const data = await tryGet(`/prescricoes/${encodeURIComponent(id)}/url-document/full`, tokenParam);
    const url = pickUrl(data);
    if (url) {
      pdfUrl = url;
      source = 'pdf-url';
    }
  } catch { /* best-effort */ }

  // GET /prescricoes/{id}/get-digital-prescription-link?token={token}
  try {
    const data = await tryGet(`/prescricoes/${encodeURIComponent(id)}/get-digital-prescription-link`, tokenParam);
    const picked = pickDigital(data);
    if (picked.link) {
      digitalLink = picked.link;
      unlockCode = picked.unlockCode || unlockCode;
      source = source || 'digital-link';
    }
  } catch { /* best-effort */ }

  return { pdfUrl, digitalLink, unlockCode, source };
}

module.exports = {
  fetchPrescriptionArtifacts
};
