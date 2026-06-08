#!/usr/bin/env node
/** Probe rápido: setPaciente mínimo isolado vs idExterno já usado. */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const AT = process.env.ATENDIMENTO_ID || 'c302bd9e-060a-4ee8-b4cf-0c78392f60c6';
const PANEL = (process.env.PANEL_URL || 'http://127.0.0.1:3003').replace(/\/$/, '');
const BACKEND = (process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');

const envPath = path.join('mdoctor-panel', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const USER = process.env.TOUR_LOGIN_USER || 'drmax.matos';
const PASS = process.env.MEDICO_PASS || process.env.TOUR_LOGIN_PASS || '';
if (!PASS) {
  console.error('MEDICO_PASS required');
  process.exit(1);
}

async function probeSetPaciente(page, idExterno, label) {
  return page.evaluate(
    async ({ idExterno, label }) => {
      const payload = { nome: 'PACIENTE TESTE 05', telefone: '11988700005', idExterno };
      const started = performance.now();
      try {
        const response = await Promise.race([
          window.MdHub.command.send('plataforma.prescricao', 'setPaciente', payload),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 15000)),
        ]);
        return {
          label,
          idExterno,
          outcome: 'OK',
          duration_ms: Math.round(performance.now() - started),
          response,
        };
      } catch (e) {
        return {
          label,
          idExterno,
          outcome: e instanceof Error && e.message === 'TIMEOUT' ? 'TIMEOUT' : 'REJECT',
          duration_ms: Math.round(performance.now() - started),
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
    { idExterno, label },
  );
}

async function main() {
  const login = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: USER, password: PASS }),
  }).then((r) => r.json());

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.addInitScript(({ jwt, user }) => {
    localStorage.setItem('mdoctor_auth_token', jwt);
    localStorage.setItem('mdoctor_auth_user', JSON.stringify(user));
  }, { jwt: login.token, user: login.user });

  await page.goto(`${PANEL}/receita?atendimentoId=${AT}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => Boolean(window.MdHub?.command?.send && window.MdSinapsePrescricao), undefined, {
    timeout: 180000,
  });
  await page.waitForTimeout(5000);

  const results = [];
  results.push(await probeSetPaciente(page, AT, 'real_idExterno'));
  results.push(await probeSetPaciente(page, `${AT}-probe-fresh`, 'fresh_idExterno'));

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
