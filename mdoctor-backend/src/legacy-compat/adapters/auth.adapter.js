function mirrorUserToLegacyMedico(req, _res, next) {
  if (req.user && !req.medico) req.medico = req.user;
  return next();
}

module.exports = {
  mirrorUserToLegacyMedico
};
