#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

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

const BACKEND = 'https://mdoctor-backend-staging-staging.up.railway.app';
const PANEL = 'https://painel-medico-staging-staging.up.railway.app';
const USER = process.env.TOUR_LOGIN_USER || 'drmax.matos';
const PASS = process.env.MEDICO_PASS || process.env.TOUR_LOGIN_PASS || '';
const AT = 'c302bd9e-060a-4ee8-b4cf-0c78392f60c6';

async function runScenario(page, freshId, mode) {
  return page.evaluate(
    async ({ freshId, mode, probeMs }) => {
      const probe = async (label, payload) => {
        const started = performance.now();
        try {
          await Promise.race([
            window.MdHub.command.send('plataforma.prescricao', 'setPaciente', payload),
            new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), probeMs)),
          ]);
          return { label, outcome: 'OK', ms: Math.round(performance.now() - started), payload };
        } catch (e) {
          return {
            label,
            outcome: e.message === 'TIMEOUT' ? 'TIMEOUT' : 'REJECT',
            ms: Math.round(performance.now() - started),
            payload,
          };
        }
      };

      const minimal = { nome: 'PACIENTE NOVO TESTE', telefone: '11988700099', idExterno: freshId };
      const full = {
        ...minimal,
        nome: 'PACIENTE NOVO TESTE - RENOVAÇÃO',
        cpf: '23100299900',
        email: 'test@mdoctor.local',
        data_nascimento: '22/01/1964',
      };

      if (mode === 'minimal_only') return [await probe('minimal_only', minimal)];
      if (mode === 'baseline_then_minimal') {
        return [await probe('baseline_full', full), await probe('minimal_after', minimal)];
      }
      return [];
    },
    { freshId, mode, probeMs: 15000 },
  );
}

async function main() {
  if (!PASS) throw new Error('MEDICO_PASS required');
  const login = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: USER, password: PASS }),
  }).then((r) => r.json());

  const freshId = `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0')}`;
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

  const minimalOnly = await runScenario(page, freshId, 'minimal_only');
  const freshId2 = `00000000-0000-4000-8000-${(Date.now() + 1).toString(16).padStart(12, '0')}`;
  const baselineThen = await runScenario(page, freshId2, 'baseline_then_minimal');

  console.log(JSON.stringify({ freshId, minimalOnly, freshId2, baselineThen }, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
