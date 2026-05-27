const { normalizeWhatsAppPayload } = require('../maps/payload.map');

function normalizeLegacyWhatsApp(req, _res, next) {
  req.body = normalizeWhatsAppPayload(req.body || {});
  return next();
}

module.exports = {
  normalizeLegacyWhatsApp
};
