const FLAGS = {
  enabled: 'LEGACY_COMPAT_ENABLED',
  whatsapp: 'LEGACY_COMPAT_WHATSAPP',
  panel: 'LEGACY_COMPAT_PANEL',
  memed: 'LEGACY_COMPAT_MEMED',
  stripe: 'LEGACY_COMPAT_STRIPE',
  typebot: 'LEGACY_COMPAT_TYPEBOT'
};

function isEnabled(name) {
  return process.env[name] === 'true';
}

function legacyCompatEnabled() {
  return isEnabled(FLAGS.enabled);
}

function integrationEnabled(integration) {
  const flagName = FLAGS[integration];
  if (!flagName) return false;
  return legacyCompatEnabled() && isEnabled(flagName);
}

function requireLegacyFlag(integration) {
  return (req, res, next) => {
    const enabled = integration ? integrationEnabled(integration) : legacyCompatEnabled();
    if (!enabled) return next('route');
    return next();
  };
}

function snapshot() {
  return Object.fromEntries(
    Object.entries(FLAGS).map(([key, envName]) => [key, isEnabled(envName)])
  );
}

module.exports = {
  FLAGS,
  integrationEnabled,
  legacyCompatEnabled,
  requireLegacyFlag,
  snapshot
};
