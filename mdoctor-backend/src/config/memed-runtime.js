/**
 * Modo Memed real vs mock — staging homologação (MEMED_REAL_ENABLED).
 * Não altera production/web; use apenas em mdoctor-backend-staging.
 */

function applyMemedEnvAliases() {
  if (!process.env.MEMED_API_KEY && process.env.MEMED_INTEGRATION_KEY) {
    process.env.MEMED_API_KEY = process.env.MEMED_INTEGRATION_KEY;
  }
  if (!process.env.MEMED_SECRET_KEY && process.env.MEMED_API_SECRET) {
    process.env.MEMED_SECRET_KEY = process.env.MEMED_API_SECRET;
  }
  if (!process.env.MEMED_PRESCRITOR_TOKEN && process.env.MEMED_TOKEN) {
    process.env.MEMED_PRESCRITOR_TOKEN = process.env.MEMED_TOKEN;
  }
  if (!process.env.MEMED_PRESCRITOR_BOARD_NUMBER && process.env.MEMED_CRM) {
    process.env.MEMED_PRESCRITOR_BOARD_NUMBER = process.env.MEMED_CRM;
  }
  if (!process.env.MEMED_PRESCRITOR_BOARD_STATE && process.env.MEMED_UF) {
    process.env.MEMED_PRESCRITOR_BOARD_STATE = process.env.MEMED_UF;
  }
  if (!process.env.MEMED_ENVIRONMENT && process.env.MEMED_ENV) {
    process.env.MEMED_ENVIRONMENT = process.env.MEMED_ENV;
  }
}

function isMemedRealEnabled() {
  return process.env.MEMED_REAL_ENABLED === 'true';
}

function allowMemedMockFallback() {
  if (isMemedRealEnabled()) return false;
  return process.env.MEMED_ALLOW_MOCK_FALLBACK !== 'false';
}

function isDeliveryRealEnabled() {
  return process.env.DELIVERY_REAL_ENABLED === 'true';
}

function isDeliveryMockEnabled() {
  if (isDeliveryRealEnabled()) return false;
  if (isMemedRealEnabled() && process.env.DELIVERY_MOCK_ENABLED !== 'true') return false;
  return process.env.DELIVERY_MOCK_ENABLED === 'true' || process.env.NODE_ENV !== 'production';
}

function isFakeMemedReceiptId(id) {
  const value = String(id || '').trim();
  if (!value) return true;
  return /^mock-/i.test(value) || /^mock-receipt-/i.test(value) || value === 'dev-mock';
}

function isFakeReceiptUrl(url) {
  const value = String(url || '').trim();
  if (!value) return false;
  if (/^\/api\//i.test(value)) return true;
  if (/example\.invalid/i.test(value)) return true;
  if (/mock-receipt/i.test(value)) return true;
  if (/^mock:/i.test(value)) return true;
  return false;
}

function assertRealMemedReceipt({ receitaId, pdfUrl, receitaUrl }) {
  if (!isMemedRealEnabled()) return { ok: true };

  const id = receitaId || null;
  const url = pdfUrl || receitaUrl || null;

  if (id && isFakeMemedReceiptId(id)) {
    return {
      ok: false,
      code: 'MEMED_MOCK_RECEIPT_BLOCKED',
      message: 'ID de receita mock bloqueado com MEMED_REAL_ENABLED=true. Use ID emitido pelo MdHub/Sinapse.'
    };
  }
  if (url && isFakeReceiptUrl(url)) {
    return {
      ok: false,
      code: 'MEMED_MOCK_URL_BLOCKED',
      message: 'URL de receita simulada bloqueada com MEMED_REAL_ENABLED=true. Informe PDF/link real da Memed.'
    };
  }
  if (url && !/^https:\/\//i.test(url)) {
    return {
      ok: false,
      code: 'MEMED_PDF_URL_HTTPS_REQUIRED',
      message: 'Com MEMED_REAL_ENABLED=true, pdfUrl/receitaUrl deve ser HTTPS (link Memed ou storage).'
    };
  }
  return { ok: true };
}

function getMemedRuntimeStatus() {
  applyMemedEnvAliases();
  const hasCredentials = Boolean(
    process.env.MEMED_API_KEY &&
      process.env.MEMED_SECRET_KEY &&
      process.env.MEMED_API_KEY !== 'sua_chave'
  );
  return {
    real_enabled: isMemedRealEnabled(),
    mock_fallback_allowed: allowMemedMockFallback(),
    delivery_mock_enabled: isDeliveryMockEnabled(),
    delivery_real_enabled: isDeliveryRealEnabled(),
    credentials_configured: hasCredentials,
    environment: process.env.MEMED_ENVIRONMENT || process.env.MEMED_ENV || 'development',
    api_url: process.env.MEMED_API_URL || null,
    callback_url: process.env.MEMED_CALLBACK_URL || null,
    script_url: process.env.MEMED_SCRIPT_URL || null,
    emission_mode: isMemedRealEnabled() ? 'sinapse_widget_real' : 'sinapse_widget_or_mock'
  };
}

applyMemedEnvAliases();

module.exports = {
  applyMemedEnvAliases,
  assertRealMemedReceipt,
  allowMemedMockFallback,
  getMemedRuntimeStatus,
  isDeliveryMockEnabled,
  isDeliveryRealEnabled,
  isFakeMemedReceiptId,
  isFakeReceiptUrl,
  isMemedRealEnabled
};
