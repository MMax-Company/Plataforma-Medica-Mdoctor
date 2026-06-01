#!/usr/bin/env node
require('./load-dotenv');
const { execSync } = require('child_process');

const PROJECT = 'bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b';
const STAGING_ENV = 'd297af6e-c5e2-406a-9798-69a02f0e7394';
const STAGING_SERVICE = '53960eb4-a1be-4d7c-b665-462049e52085';

const KEYS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_ENABLED'];

function setVar(key, value) {
  if (!value) return;
  execSync(
    `railway variable set ${key} --stdin --skip-deploys -p ${PROJECT} -e ${STAGING_ENV} -s ${STAGING_SERVICE}`,
    { input: String(value), stdio: ['pipe', 'pipe', 'pipe'] }
  );
}

const applied = [];
for (const key of KEYS) {
  const val = key === 'STRIPE_ENABLED' ? 'true' : process.env[key];
  if (!val) continue;
  setVar(key, val);
  applied.push(key);
}
console.log(JSON.stringify({ ok: true, applied }, null, 2));
