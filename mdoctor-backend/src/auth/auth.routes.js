const express = require('express');
const jwt = require('jsonwebtoken');
const { getJwtSecret, requireAuth } = require('./auth.middleware');

const router = express.Router();

function issueToken(userClaims) {
  const role = userClaims.role || 'admin';
  const token = jwt.sign(
    { sub: userClaims.sub, username: userClaims.username, role, name: userClaims.name },
    getJwtSecret(),
    { expiresIn: '8h' },
  );
  return {
    token,
    user: { id: userClaims.sub, name: userClaims.name, username: userClaims.username, role },
  };
}

function resolveUsers() {
  const users = [];

  if (process.env.MEDICO_USER && process.env.MEDICO_PASS) {
    users.push({
      username: String(process.env.MEDICO_USER).trim(),
      password: String(process.env.MEDICO_PASS).trim(),
      role: process.env.MEDICO_ROLE || 'admin',
      name: process.env.MEDICO_NOME || process.env.MEDICO_USER,
      externalId: process.env.MEDICO_EXTERNAL_ID || process.env.MEDICO_USER,
    });
  }

  if (process.env.ADMIN_USER && process.env.ADMIN_PASS) {
    users.push({
      username: String(process.env.ADMIN_USER).trim(),
      password: String(process.env.ADMIN_PASS).trim(),
      role: process.env.ADMIN_ROLE || 'administrativo',
      name: process.env.ADMIN_NOME || process.env.ADMIN_USER,
      externalId: process.env.ADMIN_EXTERNAL_ID || process.env.ADMIN_USER,
    });
  }

  return users;
}

router.post('/login', (req, res) => {
  const { user, username, email, password } = req.body || {};
  const login = String(user || username || email || '').trim();

  const users = resolveUsers();
  if (!users.length) {
    return res.status(503).json({ success: false, error: 'Credenciais não configuradas' });
  }

  const matched = users.find(
    (u) => u.username === login && u.password === String(password || ''),
  );

  if (!matched) {
    return res.status(401).json({ success: false, error: 'Credenciais inválidas' });
  }

  const session = issueToken({
    sub: matched.externalId,
    username: matched.username,
    role: matched.role,
    name: matched.name,
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
