#!/usr/bin/env node
/** approve → memed_processing + persistência mock (sem validate/deliver). */
process.env.FLOW = 'memed';
require('./homologacao-clinica-fase2-e2e.js');
