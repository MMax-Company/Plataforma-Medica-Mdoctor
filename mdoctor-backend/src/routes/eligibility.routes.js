const express = require('express');
const eligibilityEngine = require('../eligibility/engine');

const router = express.Router();

router.post('/', (req, res) => {
  const decision = eligibilityEngine.evaluate(req.body || {});

  res.json({
    success: true,
    ...decision,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
