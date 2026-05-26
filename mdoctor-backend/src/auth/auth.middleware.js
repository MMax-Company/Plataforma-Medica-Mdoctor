const jwt = require('jsonwebtoken');

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET obrigatório em produção');
  }
  return secret || 'dev_secret_change_in_prod';
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ success: false, error: 'Token de autenticação ausente' });
  }

  try {
    req.user = jwt.verify(token, getJwtSecret());
    return next();
  } catch {
    return res.status(401).json({ success: false, error: 'Token de autenticação inválido ou expirado' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, () => requireRole(...roles)(req, res, next));
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Acesso não autorizado para este perfil' });
    }
    return next();
  };
}

module.exports = {
  getJwtSecret,
  requireAuth,
  requireRole
};
