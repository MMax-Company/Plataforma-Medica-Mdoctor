const express = require('express');

const router = express.Router();

const VIACEP_TIMEOUT_MS = Number(process.env.CEP_LOOKUP_TIMEOUT_MS || 5000);
const VIACEP_MAX_ATTEMPTS = Number(process.env.CEP_LOOKUP_MAX_ATTEMPTS || 3);
const VIACEP_RETRY_DELAY_MS = Number(process.env.CEP_LOOKUP_RETRY_DELAY_MS || 300);

// Falhas transitórias de rede (não erro de negócio, ex.: CEP inexistente) —
// só essas justificam retry. Achado real em produção (21/08/2026):
// AggregateError EHOSTUNREACH/ENETUNREACH ao chamar a ViaCEP.
const RETRYABLE_NETWORK_CODES = new Set([
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ECONNREFUSED'
]);

function collectErrorCodes(error, codes = new Set(), depth = 0) {
  if (!error || depth > 3) return codes;
  if (error.code) codes.add(error.code);
  if (error.cause) collectErrorCodes(error.cause, codes, depth + 1);
  if (Array.isArray(error.errors)) {
    for (const nested of error.errors) collectErrorCodes(nested, codes, depth + 1);
  }
  return codes;
}

function isRetryableNetworkError(error) {
  const codes = collectErrorCodes(error);
  for (const code of codes) {
    if (RETRYABLE_NETWORK_CODES.has(code)) return true;
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emptyResult(cep) {
  return { logradouro: '', bairro: '', cidade: '', estado: '', cep, encontrado: false };
}

async function fetchViaCep(cep) {
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
}

async function lookupCep(rawCep) {
  const cep = String(rawCep || '').replace(/\D/g, '');

  if (cep.length !== 8) {
    return emptyResult(cep);
  }

  for (let attempt = 1; attempt <= VIACEP_MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchViaCep(cep);
    } catch (error) {
      const retryable = isRetryableNetworkError(error);
      console.error('cep_lookup_error', error.message, error.cause, { attempt, retryable });
      if (!retryable || attempt === VIACEP_MAX_ATTEMPTS) {
        // Falha de negócio (não retryable) ou tentativas esgotadas: preserva
        // o fallback manual já existente (encontrado:false), sem travar nem
        // reiniciar o Typebot — quem chama trata isso como "não encontrado".
        return emptyResult(cep);
      }
      await sleep(VIACEP_RETRY_DELAY_MS);
    }
  }

  return emptyResult(cep);
}

router.post('/', async (req, res) => {
  res.json(await lookupCep(req.body && req.body.cep));
});

router.get('/:cep', async (req, res) => {
  res.json(await lookupCep(req.params.cep));
});

module.exports = router;
module.exports.lookupCep = lookupCep;
