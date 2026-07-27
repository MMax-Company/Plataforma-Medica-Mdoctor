const express = require('express');

const router = express.Router();

const VIACEP_TIMEOUT_MS = Number(process.env.CEP_LOOKUP_TIMEOUT_MS || 5000);

function emptyResult(cep) {
  return { logradouro: '', bairro: '', cidade: '', estado: '', cep, encontrado: false };
}

async function lookupCep(rawCep) {
  const cep = String(rawCep || '').replace(/\D/g, '');

  if (cep.length !== 8) {
    return emptyResult(cep);
  }

  try {
    const response = await Promise.race([
      fetch(`https://viacep.com.br/ws/${cep}/json/`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('cep_lookup_timeout')), VIACEP_TIMEOUT_MS))
    ]);
    if (!response.ok) return emptyResult(cep);

    const data = await response.json();
    if (!data || data.erro) return emptyResult(cep);

    return {
      logradouro: data.logradouro || '',
      bairro: data.bairro || '',
      cidade: data.localidade || '',
      estado: data.uf || '',
      cep,
      encontrado: true
    };
  } catch (error) {
    console.error('cep_lookup_error', error.message, error.cause);
    return emptyResult(cep);
  }
}

router.post('/', async (req, res) => {
  res.json(await lookupCep(req.body && req.body.cep));
});

router.get('/:cep', async (req, res) => {
  res.json(await lookupCep(req.params.cep));
});

module.exports = router;
module.exports.lookupCep = lookupCep;
