const express = require('express');

const router = express.Router();

const VIACEP_TIMEOUT_MS = Number(process.env.CEP_LOOKUP_TIMEOUT_MS || 5000);

function emptyResult(cep) {
  return { logradouro: '', bairro: '', cidade: '', estado: '', cep, encontrado: false };
}

router.get('/:cep', async (req, res) => {
  const cep = String(req.params.cep || '').replace(/\D/g, '');

  if (cep.length !== 8) {
    return res.json(emptyResult(cep));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VIACEP_TIMEOUT_MS);

  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: controller.signal });
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
    return res.json(emptyResult(cep));
  } finally {
    clearTimeout(timeout);
  }
});

module.exports = router;
