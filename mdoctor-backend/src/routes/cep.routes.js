const express = require('express');

const router = express.Router();

const VIACEP_TIMEOUT_MS = Number(process.env.CEP_LOOKUP_TIMEOUT_MS || 5000);

function emptyResult(cep) {
  return { logradouro: '', bairro: '', cidade: '', estado: '', cep, encontrado: false };
}

router.post('/', async (req, res) => {
  req.params = { cep: (req.body && req.body.cep) || '' };
  return lookupHandler(req, res);
});

router.get('/:cep', lookupHandler);

async function lookupHandler(req, res) {
  const cep = String(req.params.cep || '').replace(/\D/g, '');

  if (cep.length !== 8) {
    return res.json(emptyResult(cep));
  }

  try {
    const response = await Promise.race([
      fetch(`https://viacep.com.br/ws/${cep}/json/`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('cep_lookup_timeout')), VIACEP_TIMEOUT_MS))
    ]);
    if (!response.ok) return res.json(emptyResult(cep));

    const data = await response.json();
    if (!data || data.erro) return res.json(emptyResult(cep));

    return res.json({
      logradouro: data.logradouro || '',
      bairro: data.bairro || '',
      cidade: data.localidade || '',
      estado: data.uf || '',
      cep,
      encontrado: true
    });
  } catch (error) {
    console.error('cep_lookup_error', error.message, error.cause);
    return res.json(emptyResult(cep));
  }
}

module.exports = router;
