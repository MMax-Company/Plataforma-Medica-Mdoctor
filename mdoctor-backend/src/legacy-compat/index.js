const legacyCompatRoutes = require('./routes');
const { snapshot } = require('./feature-flags');

module.exports = {
  legacyCompatRoutes,
  legacyCompatFlags: snapshot
};
