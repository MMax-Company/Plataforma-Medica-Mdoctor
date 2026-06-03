#!/usr/bin/env node
/** Requer ATENDIMENTO_ID em status ready. */
process.env.FLOW = 'deliver';
require('./homologacao-clinica-fase2-e2e.js');
