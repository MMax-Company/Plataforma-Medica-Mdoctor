const express = require('express');
const jwt = require('jsonwebtoken');
const { getJwtSecret, requireAuth } = require('./auth.middleware');

const router = express.Router();

function issueToken(userClaims) {
  const role = userClaims.role || process.env.MEDICO_ROLE || 'admin';
  const resolvedUsername = userClaims.username;
  const externalId = userClaims.sub;
  const displayName = userClaims.name || resolvedUsername;

  const token = jwt.sign(
    {
      sub: externalId,
      username: resolvedUsername,
      role,
      name: displayName,
    },
    getJwtSecret(),
    { expiresIn: '8h' },
  );

  return {
    token,
    user: {
      id: externalId,
      name: displayName,
      username: resolvedUsername,
      role,
    },
  };
}

router.post('/login', (req, res) => {
  const { user, username, email, password } = req.body || {};
  const login = String(user || username || email || '').trim();
  const expectedUser = String(process.env.MEDICO_USER || '').trim();
  const expectedPass = String(process.env.MEDICO_PASS || '').trim();

  if (!expectedUser || !expectedPass) {
    return res.status(503).json({ success: false, error: 'Credenciais médicas não configuradas' });
  }

  if (login !== expectedUser || password !== expectedPass) {
    return res.status(401).json({ success: false, error: 'Credenciais inválidas' });
  }

  const role = process.env.MEDICO_ROLE || 'admin';
  const resolvedUsername = expectedUser;
  const externalId = process.env.MEDICO_EXTERNAL_ID || resolvedUsername;
  const displayName = process.env.MEDICO_NOME || resolvedUsername;

  const session = issueToken({
    sub: externalId,
    username: resolvedUsername,
    role,
    name: displayName,
  });

  return res.json({ success: true, ...session });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.sub,
      name: req.user.name || req.user.username,
      username: req.user.username,
      role: req.user.role,
    },
  });
});

router.post('/refresh', requireAuth, (req, res) => {
  const session = issueToken(req.user);
  return res.json({ success: true, ...session });
});

router.post('/logout', requireAuth, (_req, res) => {
  return res.json({ success: true });
});

module.exports = router;
