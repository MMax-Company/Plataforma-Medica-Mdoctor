const express = require('express');
const jwt = require('jsonwebtoken');
const { getJwtSecret, requireAuth } = require('./auth.middleware');

const router = express.Router();

router.post('/login', (req, res) => {
  const { user, username, email, password } = req.body || {};
  const login = user || username || email;
  const expectedUser = process.env.MEDICO_USER || (process.env.NODE_ENV === 'production' ? '' : 'admin');
  const expectedPass = process.env.MEDICO_PASS || (process.env.NODE_ENV === 'production' ? '' : 'admin123');

  if (!expectedUser || !expectedPass) {
    return res.status(503).json({ success: false, error: 'Credenciais médicas não configuradas' });
  }

  if (login !== expectedUser || password !== expectedPass) {
    return res.status(401).json({ success: false, error: 'Credenciais inválidas' });
  }

  const role = process.env.MEDICO_ROLE || 'admin';

  const token = jwt.sign(
    {
      sub: process.env.MEDICO_EXTERNAL_ID || expectedUser,
      username: expectedUser,
      role,
      name: process.env.MEDICO_NOME || expectedUser
    },
    getJwtSecret(),
    { expiresIn: '8h' }
  );

  return res.json({
    success: true,
    token,
    user: {
      id: process.env.MEDICO_EXTERNAL_ID || expectedUser,
      name: process.env.MEDICO_NOME || expectedUser,
      username: expectedUser,
      role
    }
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.sub,
      name: req.user.name || req.user.username,
      username: req.user.username,
      role: req.user.role
    }
  });
});

module.exports = router;
