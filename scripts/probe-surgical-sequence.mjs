#!/usr/bin/env node
/** Replica ordem cirúrgica: getUsuario → BASELINE timeout → TEST_A minimal. */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const AT = process.env.ATENDIMENTO_ID || 'c302bd9e-060a-4ee8-b4cf-0c78392f60c6';
const PANEL = (process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app').replace(/\/$/, '');
const BACKEND = (process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const PROBE_MS = 12000;

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

async function main() {
  if (!PASS) throw new Error('MEDICO_PASS required');
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

  const results = await page.evaluate(
    async ({ probeMs, AT }) => {
      const probe = async (id, mod, cmd, payload) => {
        const started = performance.now();
        try {
          const response = await Promise.race([
            window.MdHub.command.send(mod, cmd, payload),
            new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), probeMs)),
          ]);
          return {
            id,
            outcome: 'OK',
            ms: Math.round(performance.now() - started),
            payload,
            response,
          };
        } catch (e) {
          return {
            id,
            outcome: e.message === 'TIMEOUT' ? 'TIMEOUT' : 'REJECT',
            ms: Math.round(performance.now() - started),
            payload,
            error: String(e.message),
          };
        }
      };

      const out = [];
      out.push(await probe('PRE', 'plataforma.usuario', 'getUsuario'));
      out.push(
        await probe('BASELINE', 'plataforma.prescricao', 'setPaciente', {
          nome: 'PACIENTE TESTE 05 - RENOVAÇÃO RECEITA',
          telefone: '11988700005',
          idExterno: AT,
          cpf: '23100299900',
          email: 'homolog.teste05@mdoctor.local',
          data_nascimento: '22/01/1964',
        }),
      );
      out.push(
        await probe('TEST_A', 'plataforma.prescricao', 'setPaciente', {
          nome: 'PACIENTE TESTE 05',
          telefone: '11988700005',
          idExterno: AT,
        }),
      );
      out.push(await probe('TEST_A_NP', 'plataforma.prescricao', 'newPrescription'));
      out.push(
        await probe('TEST_A_ITEM', 'plataforma.prescricao', 'addItem', {
          nome: 'Losartana 50mg',
          posologia: 'Tomar 1 comprimido por via oral a cada 24 horas. Uso contínuo.',
          quantidade: 30,
        }),
      );
      try {
        window.MdHub.module.show('plataforma.prescricao');
        out.push({ id: 'SHOW', outcome: 'OK', ms: 0 });
      } catch (e) {
        out.push({ id: 'SHOW', outcome: 'REJECT', ms: 0, error: String(e) });
      }
      return out;
    },
    { probeMs: PROBE_MS, AT },
  );

  console.log(JSON.stringify(results, null, 2));
  const shotPath = path.join('docs', 'MEMED-PAYLOAD-MINIMO-VALIDACAO.png');
  await page.screenshot({ path: shotPath, fullPage: false });
  console.log('screenshot:', shotPath);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
