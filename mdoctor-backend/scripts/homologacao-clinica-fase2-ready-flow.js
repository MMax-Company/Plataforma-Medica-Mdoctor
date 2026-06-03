#!/usr/bin/env node
/** Requer ATENDIMENTO_ID em memed_processing com receita mock. */
process.env.FLOW = 'ready';
require('./homologacao-clinica-fase2-e2e.js');
