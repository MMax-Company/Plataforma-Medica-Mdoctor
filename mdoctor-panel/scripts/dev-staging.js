/* eslint-disable no-console */
const { spawn } = require('node:child_process');

const backendStagingUrl = 'https://mdoctor-backend-staging-staging.up.railway.app';

const child = spawn('npx', ['next', 'dev', '-p', '3000'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    NEXT_PUBLIC_API_URL: backendStagingUrl
  }
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
