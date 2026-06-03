#!/usr/bin/env node
const path = require('path');
const { spawnSync } = require('child_process');

const env = {
  ...process.env,
  MEDICO_USER: process.env.MEDICO_USER || 'drmax.matos',
};

const result = spawnSync(process.execPath, [path.join(__dirname, '../mdoctor-backend/scripts/homologacao-5-pacientes-fila.js')], {
  env,
  stdio: 'inherit',
  cwd: path.join(__dirname, '../mdoctor-backend'),
});
process.exit(result.status ?? 1);
