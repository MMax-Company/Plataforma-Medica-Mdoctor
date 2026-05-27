const { legacyFilaResponse } = require('../maps/payload.map');

function adaptLegacyFilaResponse(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (body) => originalJson(legacyFilaResponse(body));
  return next();
}

module.exports = {
  adaptLegacyFilaResponse
};
